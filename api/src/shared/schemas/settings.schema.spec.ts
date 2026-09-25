import { SettingsSchema } from './settings.schema';

describe('SettingsSchema', () => {
  // One settings document per user: the database, not find-then-create code, guarantees it.
  it('declares a unique index on userId', () => {
    expect(SettingsSchema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
  });
});
