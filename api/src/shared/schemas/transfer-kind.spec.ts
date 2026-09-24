import { isNonSpendingTransfer, NOT_DELETED, SPENDING_ONLY, NON_SPENDING_KINDS } from './transfer-kind';

describe('transfer-kind constants', () => {
  it('treats internal and unresolved as non-spending', () => {
    expect(isNonSpendingTransfer('internal')).toBe(true);
    expect(isNonSpendingTransfer('unresolved')).toBe(true);
  });

  // Ordinary card transactions have no transferKind at all and MUST count.
  it('treats external and absent as spending', () => {
    expect(isNonSpendingTransfer('external')).toBe(false);
    expect(isNonSpendingTransfer(undefined)).toBe(false);
    expect(isNonSpendingTransfer(null)).toBe(false);
    expect(isNonSpendingTransfer('')).toBe(false);
  });

  it('NOT_DELETED matches only live rows', () => {
    expect(NOT_DELETED).toEqual({ deletedAt: null });
  });

  it('SPENDING_ONLY excludes deleted rows and non-spending kinds', () => {
    expect(SPENDING_ONLY).toEqual({
      deletedAt: null,
      transferKind: { $nin: [...NON_SPENDING_KINDS] },
    });
  });
});
