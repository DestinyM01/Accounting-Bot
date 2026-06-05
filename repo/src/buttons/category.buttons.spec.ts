import { categoryButtons } from './category.buttons';

type Btn = { text: string; callback_data: string };

const flatten = (markup: ReturnType<typeof categoryButtons>): Btn[] =>
  markup.reply_markup.inline_keyboard.flat() as Btn[];

describe('categoryButtons', () => {
  // Telegram rejects inline buttons whose `text` is empty/undefined, which makes
  // ctx.reply throw and the category picker silently vanish. Every supported
  // language must therefore yield a non-empty label for every built-in category.
  it.each(['en', 'es', 'ua', 'pl'])(
    'renders non-empty button text for every category in "%s"',
    (lang) => {
      for (const btn of flatten(categoryButtons('tx123', lang))) {
        expect(typeof btn.text).toBe('string');
        expect(btn.text.length).toBeGreaterThan(0);
      }
    },
  );

  it('falls back to a non-empty label for an unknown language', () => {
    for (const btn of flatten(categoryButtons('tx123', 'fr'))) {
      expect(typeof btn.text).toBe('string');
      expect(btn.text.length).toBeGreaterThan(0);
    }
  });

  it('builds callback data as cat_<category>_<transactionId>', () => {
    const btns = flatten(categoryButtons('abc', 'es'));
    expect(btns.every((b) => b.callback_data.startsWith('cat_'))).toBe(true);
    expect(btns.every((b) => b.callback_data.endsWith('_abc'))).toBe(true);
  });
});
