import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsAnalytics(language: string = 'en') {
  const lang = language || 'en';
  const baseButtons = [
    [Markup.button.callback(BUTTONS[lang].TODAY, 'for_today'), Markup.button.callback(BUTTONS[lang].WEEK, 'for_week')],
    [Markup.button.callback(BUTTONS[lang].MONTH, 'for_month'), Markup.button.callback(BUTTONS[lang].FOR_3_MONTHS, 'for_3_month')],
    [Markup.button.callback(BUTTONS[lang].BACK, 'backSettings')],
  ];
  return Markup.inlineKeyboard(baseButtons);
}

export function actionButtonsBackSettings(language: string = 'en') {
  const baseButtons = [[Markup.button.callback(BUTTONS[language].BACK, 'backSettings')]];
  return Markup.inlineKeyboard(baseButtons);
}
