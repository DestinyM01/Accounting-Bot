import { banreservasParser } from './banreservas.parser';

const INCOMING = `| ¡Transacción realizada! |
| Monto: |
| DOP 1,225.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| CARLOS MANUEL PEREZ SANTOS, CuentaAhorro DOP ** - 4500 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002 |
| Fecha de transacción: |
| 18 de Septiembre 2026 - 11:52 AM |
| Impuestos: |
| DOP 2.45 |
| Número de transacción: |
| 100000000001 |`;

const OUTGOING = `| ¡Transacción realizada! |
| Monto: |
| DOP 800.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002 |
| Destino: |
| ALGUIEN MAS, CuentaAhorro DOP ** - 9999 |
| Fecha de transacción: |
| 20 de Octubre 2026 - 09:05 AM |
| Impuestos: |
| DOP 1.50 |
| Número de transacción: |
| 100000000002 |`;

// Own account → the user's own loan. The destination carries the user's own
// name, which the old name-based rule read as "money arrived in my account"
// and booked as income. It is a loan payment: money left, to a non-cash
// destination — an external expense.
const OWN_TO_OWN_LOAN = `| ¡Transacción realizada! |
| Monto: |
| DOP 5,000.00 |
| #concept# |
| Transacción: |
| Pago de préstamo |
| Origen: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2003 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, Prestamo ** - 3050 |
| Fecha de transacción: |
| 5 de Noviembre 2026 - 10:15 AM |
| Impuestos: |
| DOP 0.00 |
| Número de transacción: |
| 100000000003 |`;

// Own account → own account at another bank: a funding move, not an expense.
const OWN_TO_OWN_CASH = `| ¡Transacción realizada! |
| Monto: |
| DOP 12,000.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2003 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2001 |
| Fecha de transacción: |
| 6 de Noviembre 2026 - 08:30 AM |
| Impuestos: |
| DOP 0.00 |
| Número de transacción: |
| 100000000004 |`;

const THIRD_PARTY_TO_OWN = `| ¡Transacción realizada! |
| Monto: |
| DOP 3,300.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| MARIA ALTAGRACIA GOMEZ REYES, CuentaAhorro DOP ** - 4400 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2003 |
| Fecha de transacción: |
| 7 de Noviembre 2026 - 02:45 PM |
| Impuestos: |
| DOP 1.10 |
| Número de transacción: |
| 100000000005 |`;

// A label line that starts with "Monto:" but carries more text precedes the
// real "Monto:" label. A prefix match would take the value after the first
// one and report the wrong amount; only an exact label match is safe.
const MONTO_PREFIX_COLLISION = `| ¡Transacción realizada! |
| Monto: Total con impuestos |
| DOP 802.45 |
| Monto: |
| DOP 800.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002 |
| Destino: |
| ALGUIEN MAS, CuentaAhorro DOP ** - 9999 |
| Fecha de transacción: |
| 20 de Octubre 2026 - 09:05 AM |
| Impuestos: |
| DOP 2.45 |
| Número de transacción: |
| 100000000006 |`;

const OWN = ['2002', 'JUAN ANTONIO RIVERA MARTE'];
const OWN_CASH = ['2001', '2002', '2003'];

describe('banreservasParser', () => {
  it('books an incoming wire as income and strips the thousands separator', () => {
    const r = banreservasParser.parse({
      subject: 'Recibo de la transacción',
      body: INCOMING,
      ownIdentifiers: OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('income');
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(1225);
    expect(r.counterparty).toBe('CARLOS MANUEL PEREZ SANTOS');
    expect(r.externalRef).toBe('100000000001');
    expect(r.isWithdrawal).toBe(false);
  });

  it('parses the Spanish long date', () => {
    const r = banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: OWN, ownCashAccounts: OWN_CASH })!;
    expect(r.occurredAt.getDate()).toBe(18);
    expect(r.occurredAt.getMonth()).toBe(8); // Septiembre
    expect(r.occurredAt.getFullYear()).toBe(2026);
    expect(r.occurredAt.getHours()).toBe(11);
  });

  it('books an outgoing wire to a third party as an external expense', () => {
    const r = banreservasParser.parse({ subject: 'x', body: OUTGOING, ownIdentifiers: OWN, ownCashAccounts: OWN_CASH })!;
    expect(r.direction).toBe('expense');
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(800);
    expect(r.counterparty).toBe('ALGUIEN MAS');
    expect(r.occurredAt.getMonth()).toBe(9); // Octubre
  });

  // The regression guard. The user's loan carries the user's own name, so a
  // name match on the destination must never mean "money came to me".
  it('books a payment to the user\'s own-named loan as an external expense, never income', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: OWN_TO_OWN_LOAN,
      ownIdentifiers: OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('expense');
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(5000);
  });

  it('classifies own account → own cash account as an internal transfer', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: OWN_TO_OWN_CASH,
      ownIdentifiers: OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('expense');
    expect(r.transferKind).toBe('internal');
    expect(r.amount).toBe(12000);
  });

  it('classifies third party → own cash account as external income', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: THIRD_PARTY_TO_OWN,
      ownIdentifiers: OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('income');
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(3300);
    expect(r.counterparty).toBe('MARIA ALTAGRACIA GOMEZ REYES');
  });

  // Without OWN_CASH_ACCOUNTS there is no way to know the destination is the
  // user's; the own name on it is not evidence. Refuse rather than guess.
  it('returns null for an incoming wire when no own cash accounts are configured — the destination name never decides', () => {
    expect(
      banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: OWN }),
    ).toBeNull();
  });

  it('is not fooled by a longer label sharing a prefix', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: MONTO_PREFIX_COLLISION,
      ownIdentifiers: OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.amount).toBe(800);
  });

  it('returns null when neither party matches — never guesses direction', () => {
    expect(
      banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: ['9999'] }),
    ).toBeNull();
  });

  it('returns null when no own identifiers are configured', () => {
    expect(
      banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: [] }),
    ).toBeNull();
  });

  it('treats #concept# as a placeholder, not a description', () => {
    const r = banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: OWN, ownCashAccounts: OWN_CASH })!;
    expect(r.counterparty).not.toContain('#concept#');
  });

  it('does not treat a longer account number as our own (digit-boundary match)', () => {
    const nearMiss = INCOMING.replace('** - 2002', '** - 32002');
    expect(
      banreservasParser.parse({
        subject: 'x',
        body: nearMiss,
        ownIdentifiers: ['2002'],
        ownCashAccounts: ['2002'],
      }),
    ).toBeNull();
  });

  // A name fragment in ownIdentifiers answers only "is the SENDER me?". It
  // never makes a destination the user's own.
  it('still matches a name fragment by substring, to identify the sender', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: OUTGOING,
      ownIdentifiers: ['JUAN ANTONIO RIVERA MARTE'],
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('expense');
    expect(r.transferKind).toBe('external');
  });

  it('recognises the sender by cash account when no name fragment is configured', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: OUTGOING,
      ownIdentifiers: [],
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('expense');
    expect(r.transferKind).toBe('external');
  });
});
