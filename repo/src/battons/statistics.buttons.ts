import { BUTTONS } from '../constants';
import { Markup } from 'telegraf';
import { IContext } from '../type/interface';

export function actionButtonsStatistics(language: string = 'en') {
  const lang = BUTTONS[language] ? language : 'en';
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(BUTTONS[lang].BALANCE, 'balance'),
      Markup.button.callback(BUTTONS[lang].SELECT_YEAR, 'select_year'),
    ],
    [
      Markup.button.callback(BUTTONS[lang].TODAY, 'today'),
      Markup.button.callback(BUTTONS[lang].WEEK, 'on_week'),
      Markup.button.callback(BUTTONS[lang].MONTH, 'on_month'),
    ],
    [
      Markup.button.callback(BUTTONS[lang].MY_INCOME, 'my_income'),
      Markup.button.callback(BUTTONS[lang].MY_EXPENSE, 'my_expense'),
      Markup.button.callback(BUTTONS[lang].BY_CATEGORY, 'by_category'),
    ],
    [Markup.button.callback('📊 Category Chart', 'category_chart')],
    [Markup.button.callback(`${BUTTONS[lang].ADVSTAT}`, 'advanced_statistics')],
    [Markup.button.callback(BUTTONS[lang].BACK, 'back')],
  ]);
}

export function actionButtonsMonths(language: string = 'en', selectedYear: number, availableMonths: number[]) {
  const monthNames = [
    BUTTONS[language].JANUARY,
    BUTTONS[language].FEBRUARY,
    BUTTONS[language].MARCH,
    BUTTONS[language].APRIL,
    BUTTONS[language].MAY,
    BUTTONS[language].JUNE,
    BUTTONS[language].JULY,
    BUTTONS[language].AUGUST,
    BUTTONS[language].SEPTEMBER,
    BUTTONS[language].OCTOBER,
    BUTTONS[language].NOVEMBER,
    BUTTONS[language].DECEMBER,
  ];

  const buttons = availableMonths.map((month) =>
    Markup.button.callback(monthNames[month - 1], `Month:${selectedYear}:${month}`),
  );

  buttons.push(
    Markup.button.callback(`${BUTTONS[language].YEARS}${selectedYear}`, `selectedDate:${selectedYear}`),
    Markup.button.callback(BUTTONS[language].BACK, 'backS'),
  );

  return Markup.inlineKeyboard(buttons, { columns: 2 });
}

export function actionButtonsDays(
  language: string = 'en',
  selectedYear: number,
  selectedMonth: number,
  availableDays: number[],
) {
  const buttons = availableDays.map((day) =>
    Markup.button.callback(day.toString(), `Day:${selectedYear}:${selectedMonth}:${day}`),
  );

  const monthButton = Markup.button.callback(
    `${BUTTONS[language].MONTHS}${selectedMonth}`,
    `selectedDate:${selectedYear}:${selectedMonth}`,
  );
  const backButton = Markup.button.callback(BUTTONS[language].BACK, 'backS');
  const buttonsInColumns: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 7) {
    buttonsInColumns.push(buttons.slice(i, i + 7));
  }
  buttonsInColumns.push([monthButton, backButton]);

  return Markup.inlineKeyboard(buttonsInColumns);
}

export function backStatisticButton(language: string = 'en') {
  return Markup.inlineKeyboard([Markup.button.callback(BUTTONS[language].BACK, 'backS')]);
}

export function backStatisticButtonMessage(language: string = 'en', ctx: IContext) {
  const buttons = [Markup.button.callback(BUTTONS[language].BACK, 'backS')];

  if (ctx.session.selectedDate) {
    buttons.push(
      Markup.button.callback(
        BUTTONS[language].DETAILS,
        `details:${ctx.session.selectedYear}:${ctx.session.selectedMonth}:${ctx.session.selectedDate}`,
      ),
    );
  }

  return Markup.inlineKeyboard(buttons);
}

export function actionButtonsYears(years: number[], language: string = 'en') {
  const buttons = years.map((year) => Markup.button.callback(year.toString(), `Year:${year}`));

  buttons.push(Markup.button.callback(BUTTONS[language].BACK, 'backS'));

  return Markup.inlineKeyboard(buttons, { columns: 1 });
}

// ── Category chart period pickers ─────────────────────────────────────────

export function categoryChartMenuButtons(language: string = 'en') {
  const lang = BUTTONS[language] ? language : 'en';
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 This Month', 'cat_chart_now')],
    [Markup.button.callback('📅 Last Month', 'cat_chart_prev')],
    [Markup.button.callback('🗓️ Pick a Month', 'cat_chart_years')],
    [Markup.button.callback(BUTTONS[lang].BACK, 'backS')],
  ]);
}

export function categoryChartYearButtons(years: number[], language: string = 'en') {
  const lang = BUTTONS[language] ? language : 'en';
  const buttons = years.map((year) => [Markup.button.callback(`${year}`, `cat_chart_y:${year}`)]);
  buttons.push([Markup.button.callback(BUTTONS[lang].BACK, 'backS')]);
  return Markup.inlineKeyboard(buttons);
}

export function categoryChartMonthButtons(year: number, availableMonths: number[], language: string = 'en') {
  const lang = BUTTONS[language] ? language : 'en';
  const monthNames = [
    BUTTONS[lang].JANUARY, BUTTONS[lang].FEBRUARY, BUTTONS[lang].MARCH, BUTTONS[lang].APRIL,
    BUTTONS[lang].MAY, BUTTONS[lang].JUNE, BUTTONS[lang].JULY, BUTTONS[lang].AUGUST,
    BUTTONS[lang].SEPTEMBER, BUTTONS[lang].OCTOBER, BUTTONS[lang].NOVEMBER, BUTTONS[lang].DECEMBER,
  ];
  const buttons = availableMonths.map((m) => Markup.button.callback(monthNames[m - 1], `cat_chart_m:${year}:${m}`));
  buttons.push(Markup.button.callback(BUTTONS[lang].BACK, 'backS'));
  return Markup.inlineKeyboard(buttons, { columns: 2 });
}

export function actionButtonsTransactionNames(
  transactionNames: string[],
  language: string = 'en',
  currentPage: number = 1,
) {
  const buttons = [];
  const totalItems = transactionNames.length;
  const startIndex = (currentPage - 1) * 30;
  const endIndex = Math.min(startIndex + 30, totalItems);

  const transactionButtons = [];
  for (let i = startIndex; i < endIndex; i++) {
    const name = transactionNames[i];
    transactionButtons.push(Markup.button.callback(name, `TransactionName:${name}`));

    if (transactionButtons.length === 3) {
      buttons.push([...transactionButtons]);
      transactionButtons.length = 0;
    }
  }
  const navigationButtons = [];
  if (currentPage > 1) {
    navigationButtons.push(Markup.button.callback(`⬅️`, `NextPage:${currentPage - 1}`));
  }
  if (endIndex < totalItems) {
    navigationButtons.push(Markup.button.callback(`➡️`, `NextPage:${currentPage + 1}`));
  }

  buttons.push(navigationButtons);
  buttons.push([Markup.button.callback(BUTTONS[language].BACK, 'backS')]);

  return Markup.inlineKeyboard(buttons);
}
