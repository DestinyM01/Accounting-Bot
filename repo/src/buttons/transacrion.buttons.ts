import { Markup } from 'telegraf';
import { BUTTONS } from '../constants';

export function actionButtonsTransaction(language: string = 'en') {
  const lang = (BUTTONS[language] ? language : 'en') as string;
  return Markup.inlineKeyboard(
    [
      Markup.button.callback(BUTTONS[lang].INCOME, 'income'),
      Markup.button.callback(BUTTONS[lang].EXPENSE, 'expense'),
      Markup.button.callback(BUTTONS[lang].DELETE_LAST, 'delete_last'),
      Markup.button.callback('✏️ Edit', 'edit_last'),
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

/** Shows last N transactions as a list for editing — one button per transaction. */
export function editTransactionListButtons(
  transactions: { _id: any; transactionName: string; amount: number }[],
  language: string = 'en',
) {
  const lang = (BUTTONS[language] ? language : 'en') as string;
  const buttons = transactions.map((t) => [
    {
      text: `${t.transactionName}: ${Math.abs(t.amount)}`,
      callback_data: `edit_select_${t._id}`,
    },
  ]);
  buttons.push([{ text: BUTTONS[lang].BACK, callback_data: 'backT' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

/** Shown after a transaction is selected — lets user pick which field to edit. */
export function editFieldButtons(txId: string, language: string = 'en') {
  const lang = (BUTTONS[language] ? language : 'en') as string;
  return Markup.inlineKeyboard(
    [
      Markup.button.callback('📝 Name',   `edit_name_${txId}`),
      Markup.button.callback('💰 Amount', `edit_amount_${txId}`),
      Markup.button.callback(BUTTONS[lang].BACK, 'backT'),
    ],
    { columns: 2 },
  );
}
