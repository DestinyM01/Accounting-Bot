import { popularParser } from './popular.parser';

const CONSUMO = `Estimado (a)

Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

A continuación detalle de la transacción:

Monto \tMoneda \tFecha \tComercio \tEstatus \t
RD$91.42\t Peso dominicano\t 11/09/2026 \tUBER*RIDES
Aprobada\t

En caso de requerir mayor información, puede comunicarse con nosotros`;

const RETIRO = `Estimado (a)

Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

A continuación detalle de la transacción:

Monto \tMoneda \tFecha \tCajero Automatico \tEstatus \t
RD$1600.00\t Peso dominicano\t 19/09/2026 \tCajero Automatico
Aprobada\t`;

const USD = `Gracias por utilizar su VISA ISI, terminada en 8316.
Monto \tMoneda \tFecha \tComercio \tEstatus \t
US$20.00\t Dólar\t 09/09/2026 \tOPENAI
Aprobada\t`;

const DECLINADA = `Estimado (a) JUAN ANTONIO RIVERA MARTE
Gracias por utilizar su VISA ISI, terminada en 8316.
Le informamos que su transacción ha sido declinada por razones de seguridad,
su tarjeta se encuentra bloqueada`;

describe('popularParser', () => {
  it('parses an approved purchase', () => {
    const r = popularParser.parse({ subject: 'Notificación de Consumo', body: CONSUMO })!;
    expect(r).not.toBeNull();
    expect(r.amount).toBe(91.42);
    expect(r.currency).toBe('DOP');
    expect(r.direction).toBe('expense');
    expect(r.counterparty).toBe('UBER*RIDES');
    expect(r.cardLast4).toBe('8001');
    expect(r.isWithdrawal).toBe(false);
    expect(r.occurredAt.getFullYear()).toBe(2026);
    expect(r.occurredAt.getMonth()).toBe(8); // September
    expect(r.occurredAt.getDate()).toBe(11);
  });

  it('flags ATM withdrawals', () => {
    const r = popularParser.parse({ subject: 'Notificación de Retiro', body: RETIRO })!;
    expect(r.isWithdrawal).toBe(true);
    expect(r.amount).toBe(1600);
  });

  it('detects USD charges', () => {
    const r = popularParser.parse({ subject: 'Notificación de Consumo', body: USD })!;
    expect(r.currency).toBe('USD');
    expect(r.amount).toBe(20);
  });

  it('returns null for a declined transaction', () => {
    expect(popularParser.parse({ subject: 'Notificación de Consumo', body: DECLINADA })).toBeNull();
  });
});

describe('popularParser — known non-transactional mail', () => {
  // This arrives from an allow-listed sender and is tab-delimited with RD$
  // amounts, exactly the shape the consumption parser hunts for. Ingesting it
  // would invent a RD$25,000 expense out of a marketing message.
  const LIMIT_INCREASE = `Estimado (a) JUAN ANTONIO RIVERA MARTE

¡Hemos aplicado un aumento de límite a tu tarjeta!

TARJETA\t LÍMITE ANTERIOR\tNUEVO LÍMITE\t
VISA ISI\tRD$25,000\tRD$50,000\t`;

  const NOMINA = `Estimado(a): ANTONIO RIVERA JUAN No. de identificación XXX-XXXX-0000
Le informamos que ha sido acreditado el pago de su nómina en su cuenta terminada en 2001.`;

  // DELIBERATELY constructed to defeat the v1 guards (missing-date / missing-
  // "Aprobada" / "declinad") that the consumption branch relies on: this body
  // carries a real RD$ amount, a DD/MM/YYYY date, AND the word "Aprobada" — the
  // exact shape parse()'s fallback branch hunts for. The ONLY thing that can
  // stop this from turning into a bogus RD$60,000 expense is the skip-list
  // check at the top of parse(). Do not "simplify" this back to a body with no
  // date/Aprobada (like LIMIT_INCREASE above) — that would silently make the
  // test below pass for the wrong reason again, exactly the bug being fixed.
  const LIMIT_INCREASE_PARSEABLE = `Estimado (a) JUAN ANTONIO RIVERA MARTE

¡Hemos aplicado un aumento de límite a tu tarjeta!

Monto \tMoneda \tFecha \tComercio \tEstatus \t
RD$60,000.00\t Peso dominicano\t 15/09/2026 \tAumento de limite
Aprobada\t`;

  // Same idea for the payroll notice: a real RD$ amount, a DD/MM/YYYY date,
  // and "Aprobada", so only the skip list — not the v1 guards — can reject it.
  const NOMINA_PARSEABLE = `Estimado(a): ANTONIO RIVERA JUAN No. de identificación XXX-XXXX-0000
Le informamos que ha sido acreditado el pago de su nómina en su cuenta terminada en 2001.

Monto \tMoneda \tFecha \tComercio \tEstatus \t
RD$45,000.00\t Peso dominicano\t 01/09/2026 \tNomina
Aprobada\t`;

  it('flags a limit-increase notice as non-transactional', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Actualización de Límite', body: LIMIT_INCREASE })).toBe(true);
  });

  it('flags a payroll notice as non-transactional, since it carries no amount', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Notificación Depósito de Nómina', body: NOMINA })).toBe(true);
  });

  // Belt and braces: even if the orchestrator forgot the predicate, parse()
  // must not invent a RD$25,000 expense out of a marketing table.
  //
  // NOTE: this fixture carries no date and no "Aprobada", so the v1 guards
  // (missing dateM / statusM) already return null on their own — this test
  // passes even with the skip-list check deleted from parse(). It is kept
  // because it is cheap and still a real (if weaker) regression guard, but it
  // does NOT prove the skip list is doing anything. See the "...even when the
  // body could otherwise be parsed as one" test below for that proof.
  it('never parses a transaction out of a limit-increase notice', () => {
    expect(popularParser.parse({ subject: 'Actualización de Límite', body: LIMIT_INCREASE })).toBeNull();
  });

  it('never parses a transaction out of a payroll notice', () => {
    expect(popularParser.parse({ subject: 'Notificación Depósito de Nómina', body: NOMINA })).toBeNull();
  });

  // This is the test that actually exercises the skip-list check: the body is
  // built so the v1 guards (date present, "Aprobada" present, not declined)
  // would happily let it through the consumption branch. If the skip-list
  // check is ever removed from parse(), this test fails.
  it('never parses a transaction out of a limit-increase notice, even when the body could otherwise be parsed as one', () => {
    expect(
      popularParser.parse({ subject: 'Actualización de Límite', body: LIMIT_INCREASE_PARSEABLE }),
    ).toBeNull();
  });

  it('never parses a transaction out of a payroll notice, even when the body could otherwise be parsed as one', () => {
    expect(
      popularParser.parse({ subject: 'Notificación Depósito de Nómina', body: NOMINA_PARSEABLE }),
    ).toBeNull();
  });

  it('does not flag a real consumption email as non-transactional', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Notificación de Consumo', body: '' })).toBe(false);
  });
});
