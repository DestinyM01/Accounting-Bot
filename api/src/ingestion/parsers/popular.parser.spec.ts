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
    expect(r.cardLast4).toBe('7914');
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
