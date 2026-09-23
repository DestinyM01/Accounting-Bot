import { parseBhdTransfer } from './bhd-transfer.parser';

const OWN_CASH = ['2001', '2002', '2003'];

// Third party — a real expense (housing).
const TO_THIRD_PARTY = `| |
| Estimado(a): JUAN ANTONIO RIVERA |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXX4400 |
| Descripción: | |
| Monto: | RD$ 20,000.00 |
| Beneficiario: | MARIA ALTAGRACIA GOMEZ REYES |
| Número de confirmación: | M10-1111-2222-3333-4 |
| Fecha y hora de la transacción: | 28/08/2026 - 8:33 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |`;

// Subject claims "otros Bancos" but the destination is the user's own account.
const TO_OWN_OTHER_BANK = `| |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXXXXXX2003 |
| Monto: | RD$ 1,000.00 |
| Beneficiario: | JUAN ANTONIO RIVERA MARTE |
| Fecha y hora de la transacción: | 02/09/2026 - 11:07 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |`;

// The user's own name, but the destination is a loan, not a cash account.
const TO_OWN_LOAN = `| |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXX3050 |
| Monto: | RD$ 1,942.10 |
| Beneficiario: | JUAN RIVERA |
| Fecha y hora de la transacción: | 24/08/2026 - 2:51 PM |
| Tipo de transacción: | Transacciones entre mis productos |`;

describe('parseBhdTransfer', () => {
  it('classifies a third-party transfer as external', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_THIRD_PARTY, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(20000);
    expect(r.currency).toBe('DOP');
    expect(r.counterparty).toBe('MARIA ALTAGRACIA GOMEZ REYES');
    expect(r.externalRef).toBe('M10-1111-2222-3333-4');
    expect(r.occurredAt.getDate()).toBe(28);
    expect(r.occurredAt.getHours()).toBe(8);
    expect(r.isWithdrawal).toBe(false);
    expect(r.approved).toBe(true);
  });

  // The phantom-expense case. The subject says the money went to another bank;
  // it went to the user's own Santa Cruz account. Classifying on subject would
  // book RD$1,000 of spending that never happened.
  it('classifies a transfer to an own cash account as internal despite the subject', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_OTHER_BANK, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('internal');
    expect(r.amount).toBe(1000);
  });

  // Regression guard: the loan is in the user's own name. A rule keyed on the
  // beneficiary would mark this internal and erase a real monthly expense.
  it('classifies a transfer to an own non-cash product as external', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_LOAN, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(1942.1);
    expect(r.counterparty).toBe('JUAN RIVERA');
  });

  // The origin is always the user's own account. A body-wide search would
  // report every BHD transfer as internal.
  it('ignores the origin account when classifying', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_THIRD_PARTY, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
  });

  it('returns unresolved when the destination cannot be parsed', () => {
    const noDest = TO_THIRD_PARTY.replace('| Producto destino: | XXXXXX4400 |', '');
    const r = parseBhdTransfer({ subject: '', body: noDest, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('unresolved');
  });

  it('returns null when the body is not a transfer email', () => {
    expect(parseBhdTransfer({ subject: '', body: 'unrelated', ownCashAccounts: OWN_CASH })).toBeNull();
  });

  it('treats an empty ownCashAccounts as nothing being internal', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_OTHER_BANK, ownCashAccounts: [] })!;
    expect(r.transferKind).toBe('external');
  });
});
