import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsAdvancedStatistics(language: string = 'en') {
  const lang = BUTTONS[language] ? language : 'en';
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${BUTTONS[lang].TOP10}`, 'top10')],
    [Markup.button.callback(`${BUTTONS[lang].WEEK}`, 'on_week'), Markup.button.callback(`${BUTTONS[lang].MONTH}`, 'on_month')],
    [
      Markup.button.callback(`${BUTTONS[lang].MY_INCOME}`, 'my_income'),
      Markup.button.callback(`${BUTTONS[lang].MY_EXPENSE}`, 'my_expense'),
      Markup.button.callback(`${BUTTONS[lang].BY_CATEGORY}`, 'by_category'),
    ],
    [Markup.button.callback(BUTTONS[lang].BACK, 'backS')],
  ]);
}
