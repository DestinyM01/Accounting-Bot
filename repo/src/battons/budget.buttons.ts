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

export function budgetCategorySelectButtons(language: string) {
  const lang = (language || 'ua') as 'en' | 'ua' | 'pl';
  const rows = Object.values(Category).map((cat) => [
    { text: CATEGORY_LABELS[cat][lang], callback_data: `budget_cat_${cat}` },
  ]);
  const chunked: typeof rows = [];
  for (let i = 0; i < rows.length; i += 2) {
    chunked.push([...rows[i], ...(rows[i + 1] ?? [])]);
  }
  chunked.push([{ text: language === 'en' ? '⬅️ Back' : language === 'pl' ? '⬅️ Wróć' : '⬅️ Назад', callback_data: 'backToStart' }]);
  return { reply_markup: { inline_keyboard: chunked } };
}

export function budgetListButtons(language: string) {
  const backLabel = language === 'en' ? '⬅️ Back' : language === 'pl' ? '⬅️ Wróć' : '⬅️ Назад';
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: language === 'en' ? '📋 My Budgets' : language === 'pl' ? '📋 Moje budżety' : '📋 Мої бюджети', callback_data: 'budget_list' }],
        [{ text: language === 'en' ? '➕ Set Budget' : language === 'pl' ? '➕ Ustaw budżet' : '➕ Встановити бюджет', callback_data: 'budget_set' }],
        [{ text: backLabel, callback_data: 'backToStart' }],
      ],
    },
  };
}
