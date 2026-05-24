import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsTransaction(language: string = 'en') {
  const lang = (BUTTONS[language] ? language : 'en') as string;
  return Markup.inlineKeyboard(
    [
      Markup.button.callback(BUTTONS[lang].INCOME, 'income'),
      Markup.button.callback(BUTTONS[lang].EXPENSE, 'expense'),
      Markup.button.callback(BUTTONS[lang].DELETE_LAST, 'delete_last'),
      Markup.button.callback(BUTTONS[lang].RECURRING, 'recurring_menu'),
      Markup.button.callback('🔍 Search', 'search_transactions'),
      Markup.button.callback(BUTTONS[lang].BACK, 'back'),
    ],
    { columns: 2 },
  );
}
export function backTranButton(language: string = 'en') {
  return Markup.inlineKeyboard([Markup.button.callback(BUTTONS[language].BACK, 'backT')], { columns: 1 });
}
