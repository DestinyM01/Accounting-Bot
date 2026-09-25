import { CustomCategorySchema } from './custom-category.schema';

describe('CustomCategorySchema', () => {
  // A delete or rename records the move here until every reference has moved;
  // "no move in progress" must be null so guarded writes can filter on it.
  it('declares pending, defaulting to null', () => {
    const path: any = CustomCategorySchema.path('pending');
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });

  // Two simultaneous creates or renames can both pass the service's name check;
  // the database must refuse the second. Deleted records may share a name.
  it('keeps active names unique per user', () => {
    expect(CustomCategorySchema.indexes()).toContainEqual([
      { userId: 1, name: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { active: true } }),
    ]);
  });
});
