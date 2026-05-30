import { Category } from '../type/enum/category.enum';

const CATEGORY_LABELS: Record<Category, { en: string; ua: string; pl: string }> = {
  [Category.FOOD]: { en: '🍔 Food', ua: '🍔 Їжа', pl: '🍔 Jedzenie' },
  [Category.TRANSPORT]: { en: '🚗 Transport', ua: '🚗 Транспорт', pl: '🚗 Transport' },
  [Category.HOUSING]: { en: '🏠 Housing', ua: '🏠 Житло', pl: '🏠 Mieszkanie' },
  [Category.HEALTH]: { en: '💊 Health', ua: '💊 Здоров\'я', pl: '💊 Zdrowie' },
  [Category.ENTERTAINMENT]: { en: '🎮 Entertainment', ua: '🎮 Розваги', pl: '🎮 Rozrywka' },
  [Category.SALARY]: { en: '💼 Salary', ua: '💼 Зарплата', pl: '💼 Wynagrodzenie' },
  [Category.SAVINGS]: { en: '💰 Savings', ua: '💰 Заощадження', pl: '💰 Oszczędności' },
  [Category.OTHER]: { en: '📦 Other', ua: '📦 Інше', pl: '📦 Inne' },
};

export function categoryButtons(
  transactionId: string,
  language: string,
  customCategories: { name: string; emoji: string }[] = [],
) {
  const lang = (language || 'ua') as 'en' | 'ua' | 'pl';
  const builtInRows = Object.values(Category).map((cat) => [
    {
      text: CATEGORY_LABELS[cat][lang],
      callback_data: `cat_${cat}_${transactionId}`,
    },
  ]);
  const customRows = customCategories.map((c) => [
    {
      text: `${c.emoji} ${c.name}`,
      callback_data: `cat_${c.name}_${transactionId}`,
    },
  ]);
  const rows = [...builtInRows, ...customRows];
  const chunked: typeof rows = [];
  for (let i = 0; i < rows.length; i += 2) {
    chunked.push([...rows[i], ...(rows[i + 1] ?? [])]);
  }
  return { reply_markup: { inline_keyboard: chunked } };
}

const COLOR_PALETTE: { label: string; hex: string }[] = [
  { label: '🔴 Red',    hex: '#ef4444' },
  { label: '🟠 Orange', hex: '#fb923c' },
  { label: '🟡 Yellow', hex: '#eab308' },
  { label: '🟢 Green',  hex: '#22c55e' },
  { label: '🔵 Blue',   hex: '#3b82f6' },
  { label: '🟣 Purple', hex: '#a855f7' },
  { label: '🩷 Pink',   hex: '#ec4899' },
  { label: '🩵 Cyan',   hex: '#06b6d4' },
  { label: '⬛ Dark',   hex: '#374151' },
  { label: '⬜ Light',  hex: '#94a3b8' },
];

const EMOJI_LIST = ['✈️','💪','🏋️','🎓','🐶','🐱','🛒','📱','💇','🎁','⚡','🌿','🎨','🎵','🏖️','🍕','☕','🛞','📚','🎯'];

export function colorPickerButtons() {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < COLOR_PALETTE.length; i += 2) {
    const row = [{ text: COLOR_PALETTE[i].label, callback_data: `pick_color:${COLOR_PALETTE[i].hex}` }];
    if (COLOR_PALETTE[i + 1]) {
      row.push({ text: COLOR_PALETTE[i + 1].label, callback_data: `pick_color:${COLOR_PALETTE[i + 1].hex}` });
    }
    rows.push(row);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

export function emojiPickerButtons() {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < EMOJI_LIST.length; i += 4) {
    rows.push(
      EMOJI_LIST.slice(i, i + 4).map((e) => ({ text: e, callback_data: `pick_emoji:${e}` })),
    );
  }
  return { reply_markup: { inline_keyboard: rows } };
}
