import { parsePopularTransfer } from './popular-transfer.parser';

const OWN_CASH = ['2001', '2002', '2003'];

// Funding move: the user sending money to their own account at another bank.
const SENT_TO_OWN = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: JUAN ANTONIO RIVERA MART |
| Cuenta o Producto:******_2002 |
| Monto: RD$ 20,000.00 |
| Fecha: 28/8/2026 |`;

const SENT_TO_THIRD_PARTY = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: PEDRO NUNEZ |
| Cuenta o Producto:******_9911 |
| Monto: RD$ 3,500.00 |
| Fecha: 5/7/2026 |`;

// "Monto 2:" shares the "Monto" prefix with the real "Monto:" row and appears
// first. An unanchored regex would match "Monto" inside "Monto 2:" and
// capture "2: RD$ 300.00" — parseFloat then stops at the colon, so the
// amount would silently become 2 instead of 20,000.
const MONTO_PREFIX_COLLISION = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: JUAN ANTONIO RIVERA MART |
| Cuenta o Producto:******_2002 |
| Monto 2: RD$ 300.00 |
| Monto: RD$ 20,000.00 |
| Fecha: 28/8/2026 |`;

// "Fecha y hora de la transacción:" shares the "Fecha" prefix with the real
// "Fecha:" row and appears first. An unanchored regex would match "Fecha"
// inside the longer label and pull the wrong (or unparseable) date.
const FECHA_PREFIX_COLLISION = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: PEDRO NUNEZ |
| Cuenta o Producto:******_9911 |
| Monto: RD$ 3,500.00 |
| Fecha y hora de la transacción: 1/1/2020 |
| Fecha: 5/7/2026 |`;

const RECEIVED = `| Estimado(a) ANTONIO RIVERA JUAN Le informamos los detalles de la transacción de transferencia recibida en su cuenta terminada en 2001 : |
| Monto | Fecha | Canal |
|---|---|---|
| RD 2,000.00 | 7/8/2026 | APP POPULAR |`;

describe('parsePopularTransfer — sent', () => {
  it('classifies a transfer to an own cash account as internal', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.transferKind).toBe('internal');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(20000);
    expect(r.occurredAt.getDate()).toBe(28);
    expect(r.occurredAt.getMonth()).toBe(7);
  });

  it('classifies a transfer to a third party as external', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_THIRD_PARTY,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(3500);
    expect(r.counterparty).toBe('PEDRO NUNEZ');
  });

  it('parses the unpadded D/M/YYYY date', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_THIRD_PARTY,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.occurredAt.getDate()).toBe(5);
    expect(r.occurredAt.getMonth()).toBe(6);
  });

  it('is not fooled by a longer label sharing a prefix', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: MONTO_PREFIX_COLLISION,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.amount).toBe(20000);
  });

  it('does not confuse Fecha with Fecha y hora', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: FECHA_PREFIX_COLLISION,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.occurredAt.getFullYear()).toBe(2026);
    expect(r.occurredAt.getMonth()).toBe(6);
    expect(r.occurredAt.getDate()).toBe(5);
  });
});

describe('parsePopularTransfer — received', () => {
  it('parses an incoming transfer as income', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.direction).toBe('income');
    expect(r.amount).toBe(2000);
    expect(r.transferKind).toBe('external');
  });

  // "RD 2,000.00" has no dollar sign, which is why the v1 amount regex misses it.
  it('parses an amount written without a dollar sign', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.amount).toBe(2000);
  });

  it('parses the D/M/YYYY date, not M/D/YYYY', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.occurredAt.getDate()).toBe(7);
    expect(r.occurredAt.getMonth()).toBe(7);
  });
});

describe('parsePopularTransfer — not applicable', () => {
  it('returns null for a subject it does not own', () => {
    expect(parsePopularTransfer({
      subject: 'Notificación de Consumo',
      body: 'anything',
      ownCashAccounts: OWN_CASH,
    })).toBeNull();
  });
});
