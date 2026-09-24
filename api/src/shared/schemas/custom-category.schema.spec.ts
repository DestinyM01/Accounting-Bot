import { CustomCategorySchema } from './custom-category.schema';

describe('CustomCategorySchema', () => {
  // A delete or rename records the move here until every reference has moved;
  // "no move in progress" must be null so guarded writes can filter on it.
  it('declares pending, defaulting to null', () => {
    const path: any = CustomCategorySchema.path('pending');
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });
});
