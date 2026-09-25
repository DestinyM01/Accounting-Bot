import { IngestionStatusSchema } from './ingestion-status.schema';

describe('IngestionStatusSchema', () => {
  it('declares a unique index on userId', () => {
    expect(IngestionStatusSchema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
  });
});
