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

export function categoryButtons(transactionId: string, language: string) {
  const lang = (language || 'ua') as 'en' | 'ua' | 'pl';
  const rows = Object.values(Category).map((cat) => [
    {
      text: CATEGORY_LABELS[cat][lang],
      callback_data: `cat_${cat}_${transactionId}`,
    },
  ]);
  const chunked: typeof rows = [];
  for (let i = 0; i < rows.length; i += 2) {
    chunked.push([...rows[i], ...(rows[i + 1] ?? [])]);
  }
  return { reply_markup: { inline_keyboard: chunked } };
}
