import { BalanceHistorySchema } from './balance-history.schema';

describe('BalanceHistorySchema', () => {
  // The Balance page lists a user's history newest first, and its chart reads
  // a time window; without this index both scan the whole collection.
  it('declares an index on (userId, timestamp desc)', () => {
    expect(BalanceHistorySchema.indexes()).toContainEqual([{ userId: 1, timestamp: -1 }, expect.any(Object)]);
  });
});
