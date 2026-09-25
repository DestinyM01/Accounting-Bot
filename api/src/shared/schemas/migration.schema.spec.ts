import { MigrationSchema } from './migration.schema';

describe('MigrationSchema', () => {
  // One marker per one-time job: the database guarantees two pods can't both start it fresh.
  it('declares a unique index on name', () => {
    expect(MigrationSchema.indexes()).toContainEqual([{ name: 1 }, expect.objectContaining({ unique: true })]);
  });
});
