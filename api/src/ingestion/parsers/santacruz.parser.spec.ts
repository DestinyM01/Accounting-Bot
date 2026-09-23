import { santaCruzParser } from './santacruz.parser';

const CONSUMO = `NOTIFICACIÓN DE consumo

Te notificamos que desde tu tarjeta de Crédito Gold terminada en 8002
fue realizada la siguiente transacción:

Monto: RD$ 520.00
Lugar de transacción: UBER*EATS SANTO DOMINGODO
Fecha y hora: 21/9/2026 12:32:21
Estado: Aprobada`;

describe('santaCruzParser', () => {
  it('parses an approved purchase with unpadded date', () => {
    const r = santaCruzParser.parse({ subject: 'Notificación, Banco Santa Cruz', body: CONSUMO })!;
    expect(r.amount).toBe(520);
    expect(r.counterparty).toBe('UBER*EATS SANTO DOMINGODO');
    expect(r.cardLast4).toBe('6766');
    expect(r.occurredAt.getDate()).toBe(21);
    expect(r.occurredAt.getMonth()).toBe(8);
    expect(r.occurredAt.getHours()).toBe(12);
  });

  it('returns null when not approved', () => {
    expect(
      santaCruzParser.parse({ subject: 'x', body: CONSUMO.replace('Aprobada', 'Declinada') }),
    ).toBeNull();
  });
});
