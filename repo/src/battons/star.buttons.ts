import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsStart(language: string = 'en', isPremium: boolean = false) {
  const lang = language || 'en';
  const baseButtons = [
    [
      Markup.button.callback(BUTTONS[lang].TRANSACTIONS, 'transactions'),
      Markup.button.callback(BUTTONS[lang].STATISTICS, 'statistics'),
    ],
    [
      Markup.button.callback(BUTTONS[lang].BUDGETS, 'budgets'),
      Markup.button.callback(BUTTONS[lang].EXPORT, 'export'),
    ],
    [
      Markup.button.callback(BUTTONS[lang].SETTING, 'settings'),
      Markup.button.callback(BUTTONS[lang].INFO, 'info'),
    ],
  ];
  if (isPremium) {
    baseButtons.push([Markup.button.callback(`${BUTTONS[lang].PREMIUM_BUTTON}`, 'premiumMenu')]);
  }
  return Markup.inlineKeyboard(baseButtons);
}

export function infoButton(language: string = 'en') {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(BUTTONS[language].FIN, 'financial-literacy'),
      Markup.button.callback(BUTTONS[language].HELP, 'help'),
    ],
    [Markup.button.callback(BUTTONS[language].BACK, 'back')],
  ]);
}

export function backStartButton(language: string = 'en') {
  return Markup.inlineKeyboard([Markup.button.callback(BUTTONS[language].BACK, 'back')]);
}

export function backToStartButton(language: string = 'en') {
  return Markup.inlineKeyboard([Markup.button.callback(BUTTONS[language].BACK, 'backToStart')]);
}

export function backHelpButton(language: string = 'en') {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback(BUTTONS[language].SUPPORT, 'project_support'),
      Markup.button.callback(BUTTONS[language].BACK, 'back'),
    ],
    { columns: 1 },
  );
}
