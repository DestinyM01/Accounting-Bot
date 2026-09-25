import { UnreadableMailSchema } from './unreadable-mail.schema';

describe('UnreadableMailSchema', () => {
  // A mail that fails every poll must stay one record whose attempts count up, never one record per poll.
  it('declares a unique index on (userId, messageId)', () => {
    expect(UnreadableMailSchema.indexes()).toContainEqual([
      { userId: 1, messageId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
