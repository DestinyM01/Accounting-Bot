import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsSettings(language: string = 'en', bossId: number) {
  const baseButtons = [
    [
      Markup.button.callback(BUTTONS[language].FAMILY, 'family'),
      Markup.button.callback(BUTTONS[language].LANGUAGE, 'language'),
    ],
    [Markup.button.callback(BUTTONS[language].RESET, 'reset')],
    [
      Markup.button.callback(BUTTONS[language].GET_PREMIUM, 'premium'),
      Markup.button.callback('аналитика бота', 'bot_analytics'),
    ],
    [
      Markup.button.callback(BUTTONS[language].SET_BALANCE, 'change_balance'),
      Markup.button.callback(BUTTONS[language].BACK, 'back'),
    ],
  ];
  if (bossId === +process.env.BOSID) {
    baseButtons[1].push(Markup.button.callback('Адмін😎 панель🔓', 'admin'));
  }
  return Markup.inlineKeyboard(baseButtons);
}
export function languageSet() {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback('English🇬🇧', 'setLanguage:en'),
    ],
    { columns: 1 },
  );
}

export function currencySet() {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback('🇩🇴 Peso Dominicano (DOP)', 'DOP'),
      Markup.button.callback('🇺🇸 US Dollar (USD)', 'USD'),
      Markup.button.callback('🇪🇺 Euro (EUR)', 'EUR'),
    ],
    { columns: 1 },
  );
}
export function resetButton(language: string = 'en') {
  return Markup.inlineKeyboard(
    [Markup.button.callback(BUTTONS[language].YES, 'yes'), Markup.button.callback(BUTTONS[language].NO, 'no')],
    {
      columns: 2,
    },
  );
}
