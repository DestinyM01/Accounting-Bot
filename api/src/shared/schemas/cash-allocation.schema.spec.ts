import { CashAllocationSchema } from './cash-allocation.schema';

describe('CashAllocationSchema', () => {
  // Every read goes through a withdrawal: its breakdown, and the rollup's $in over a period's withdrawals.
  it('indexes items by (userId, withdrawalId)', () => {
    expect(CashAllocationSchema.indexes()).toContainEqual([{ userId: 1, withdrawalId: 1 }, expect.anything()]);
  });
});
