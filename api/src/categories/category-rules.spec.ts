import { EMOJIS, PALETTE, isKnownEmoji, isPaletteColor, nameError, normalizeName } from './category-rules';

describe('category rules', () => {
  it.each(['gym', 'side-income', 'educación', 'niños', 'a', 'x'.repeat(20)])('accepts %s', (name) => {
    expect(nameError(name)).toBeNull();
  });

  it.each([
    ['a space', 'a b'],
    ['an empty name', ''],
    ['21 characters', 'x'.repeat(21)],
    ['punctuation', 'gym!'],
    ['uppercase', 'Gym'],
  ])('rejects %s', (_label, name) => {
    expect(nameError(name)).toMatch(/lowercase letters/);
  });

  it('reserves every built-in name', () => {
    for (const name of ['food', 'transport', 'housing', 'health', 'entertainment', 'salary', 'savings', 'other', 'cash']) {
      expect(nameError(name)).toMatch(/built-in/);
    }
  });

  it('normalizes by trimming and lowercasing; anything but a string becomes empty', () => {
    expect(normalizeName('  Gym  ')).toBe('gym');
    expect(normalizeName(5)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('accepts only palette colours and the offered emoji', () => {
    expect(isPaletteColor('#3b82f6')).toBe(true);
    expect(isPaletteColor('#123456')).toBe(false);
    expect(isPaletteColor(undefined)).toBe(false);
    expect(isKnownEmoji('💪')).toBe(true);
    expect(isKnownEmoji('🦄')).toBe(false);
    expect(isKnownEmoji(7)).toBe(false);
  });

  it("keeps the bot's 10 colours and 20 emoji", () => {
    expect(PALETTE).toHaveLength(10);
    expect(EMOJIS).toHaveLength(20);
  });
});
