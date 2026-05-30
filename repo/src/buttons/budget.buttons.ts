import { Category } from '../type/enum/category.enum';

const CATEGORY_LABELS: Record<Category, { en: string; es: string; ua: string; pl: string }> = {
  [Category.FOOD]:          { en: '🍔 Food',          es: '🍔 Comida',       ua: '🍔 Їжа',           pl: '🍔 Jedzenie' },
  [Category.TRANSPORT]:     { en: '🚗 Transport',     es: '🚗 Transporte',   ua: '🚗 Транспорт',     pl: '🚗 Transport' },
  [Category.HOUSING]:       { en: '🏠 Housing',       es: '🏠 Vivienda',     ua: '🏠 Житло',         pl: '🏠 Mieszkanie' },
  [Category.HEALTH]:        { en: '💊 Health',        es: '💊 Salud',        ua: '💊 Здоров\'я',     pl: '💊 Zdrowie' },
  [Category.ENTERTAINMENT]: { en: '🎮 Entertainment', es: '🎮 Entretenimiento', ua: '🎮 Розваги',    pl: '🎮 Rozrywka' },
  [Category.SALARY]:        { en: '💼 Salary',        es: '💼 Salario',      ua: '💼 Зарплата',      pl: '💼 Wynagrodzenie' },
  [Category.SAVINGS]:       { en: '💰 Savings',       es: '💰 Ahorros',      ua: '💰 Заощадження',   pl: '💰 Oszczędności' },
  [Category.OTHER]:         { en: '📦 Other',         es: '📦 Otro',         ua: '📦 Інше',           pl: '📦 Inne' },
};

const SUPPORTED = ['en', 'es', 'ua', 'pl'] as const;
type SupportedLang = typeof SUPPORTED[number];

function safeLang(language: string): SupportedLang {
  return (SUPPORTED as readonly string[]).includes(language)
    ? (language as SupportedLang)
    : 'en';
}

function t(language: string, en: string, es: string, ua: string, pl: string) {
  const l = safeLang(language);
  if (l === 'es') return es;
  if (l === 'ua') return ua;
  if (l === 'pl') return pl;
  return en;
}

export function budgetCategorySelectButtons(
  language: string,
  customCategories: { name: string; emoji: string }[] = [],
) {
  const lang = safeLang(language);
  const builtInRows = Object.values(Category).map((cat) => [
    { text: CATEGORY_LABELS[cat][lang], callback_data: `budget_cat_${cat}` },
  ]);
  const customRows = customCategories.map((c) => [
    { text: `${c.emoji} ${c.name}`, callback_data: `budget_cat_${c.name}` },
  ]);
  const rows = [...builtInRows, ...customRows];
  const chunked: typeof rows = [];
  for (let i = 0; i < rows.length; i += 2) {
    chunked.push([...rows[i], ...(rows[i + 1] ?? [])]);
  }
  chunked.push([{ text: t(language, '⬅️ Back', '⬅️ Volver', '⬅️ Назад', '⬅️ Wróć'), callback_data: 'backToStart' }]);
  return { reply_markup: { inline_keyboard: chunked } };
}

export function budgetListButtons(language: string) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(language, '📋 My Budgets', '📋 Mis Presupuestos', '📋 Мої бюджети', '📋 Moje budżety'), callback_data: 'budget_list' }],
        [{ text: t(language, '➕ Set Budget', '➕ Fijar Presupuesto', '➕ Встановити бюджет', '➕ Ustaw budżet'), callback_data: 'budget_set' }],
        [{ text: t(language, '⬅️ Back', '⬅️ Volver', '⬅️ Назад', '⬅️ Wróć'), callback_data: 'backToStart' }],
      ],
    },
  };
}
