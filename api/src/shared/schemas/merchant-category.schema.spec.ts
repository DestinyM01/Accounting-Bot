import { MerchantCategorySchema } from './merchant-category.schema';

describe('MerchantCategorySchema', () => {
  it('keeps one remembered category per merchant', () => {
    expect(MerchantCategorySchema.indexes()).toContainEqual([
      { userId: 1, key: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
