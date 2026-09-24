import { CustomCategorySchema } from './custom-category.schema';

describe('CustomCategorySchema (bot mirror)', () => {
  // Same collection as the api's schema; a field in one and not the other is a bug.
  it('declares pending, defaulting to null', () => {
    const path: any = CustomCategorySchema.path('pending');
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });
});
