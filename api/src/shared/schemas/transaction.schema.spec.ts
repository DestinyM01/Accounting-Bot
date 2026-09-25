import { TransactionSchema } from './transaction.schema';

describe('TransactionSchema indexes', () => {
  // "One transaction per (userId, recurringId, recurringPeriod)" used to live
  // only in find-then-create code in two services. Like sourceMessageId, the
  // invariant belongs in the database. The index is partial so rows that are
  // not linked to a rule (a deliberately separate second payment) are
  // unaffected.
  it('declares a partial unique index on the recurring reconciliation key', () => {
    const indexes = TransactionSchema.indexes();

    expect(indexes).toContainEqual([
      { userId: 1, recurringId: 1, recurringPeriod: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { recurringId: { $exists: true } },
      }),
    ]);
  });

  it('keeps the unique sparse index on sourceMessageId', () => {
    const indexes = TransactionSchema.indexes();

    expect(indexes).toContainEqual([
      { sourceMessageId: 1 },
      expect.objectContaining({ unique: true, sparse: true }),
    ]);
  });
});

describe('TransactionSchema fields', () => {
  it('declares allocatedCash, the itemized-cash reservation of a withdrawal', () => {
    expect(TransactionSchema.path('allocatedCash')).toBeDefined();
  });
});
