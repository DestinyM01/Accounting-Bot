import { TransactionSchema } from './transaction.schemas';

describe('TransactionSchema indexes', () => {
  // Mirrors api/src/shared/schemas/transaction.schema.spec.ts: both services
  // back the same collection, so both schemas must declare the same index.
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
});
