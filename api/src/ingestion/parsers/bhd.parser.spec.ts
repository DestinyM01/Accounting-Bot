import { bhdParser } from './bhd.parser';

const COMPRA = `| BHD Notificación de Transacciones Visa Débito Intl # 5875 Detalle de Criterios |
| Fecha | Moneda | Monto | Comercio | Estado | Tipo |
| 18/09/2026 03:11 pm | RD | $460.00 | PedidosYa*Expreso Bonny | Aprobada | Compra |`;

const DECLINADA = `| Fecha | Moneda | Monto | Comercio | Estado | Tipo |
| 18/09/2026 03:11 pm | RD | $460.00 | ALGO | Declinada | Compra |`;

describe('bhdParser', () => {
  it('parses an approved purchase with 12-hour time', () => {
    const r = bhdParser.parse({ subject: 'BHD Notificación de Transacciones', body: COMPRA })!;
    expect(r.amount).toBe(460);
    expect(r.currency).toBe('DOP');
    expect(r.counterparty).toBe('PedidosYa*Expreso Bonny');
    expect(r.cardLast4).toBe('5875');
    expect(r.isWithdrawal).toBe(false);
    expect(r.occurredAt.getHours()).toBe(15); // 03:11 pm
    expect(r.occurredAt.getMinutes()).toBe(11);
  });

  it('returns null when not approved', () => {
    expect(bhdParser.parse({ subject: 'x', body: DECLINADA })).toBeNull();
  });
});
