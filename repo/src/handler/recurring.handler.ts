import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Markup } from 'telegraf';
import { IContext } from '../type/interface';
import { RecurringService } from '../service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { BUTTONS } from '../constants';

const HEADER = {
  en: '🔄 <b>Recurring Transactions</b>',
  es: '🔄 <b>Transacciones Recurrentes</b>',
  ua: '🔄 <b>Повторювані транзакції</b>',
  pl: '🔄 <b>Cykliczne transakcje</b>',
};

const EMPTY = {
  en: '🔄 No recurring transactions yet.\nTap <b>Add Recurring</b> to create one.',
  es: '🔄 Aún no hay transacciones recurrentes.\nPresiona <b>Agregar</b> para crear una.',
  ua: '🔄 Немає повторюваних транзакцій.\nНатисни <b>Додати</b> для створення.',
  pl: '🔄 Brak transakcji cyklicznych.\nNaciśnij <b>Dodaj</b> aby utworzyć.',
};

const ADD_BTN = {
  en: '➕ Add Recurring',
  es: '➕ Agregar Recurrente',
  ua: '➕ Додати повторювану',
  pl: '➕ Dodaj cykliczną',
};

@Update()
export class RecurringHandler {
  private readonly logger = new Logger(RecurringHandler.name);

  constructor(private readonly recurringService: RecurringService) {}

  @Action('recurring_menu')
  async recurringMenu(@Ctx() ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const items = await this.recurringService.listRecurring(ctx.from.id);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(ADD_BTN[lang] ?? ADD_BTN.en, 'recurring_add')],
      [Markup.button.callback(BUTTONS[lang]?.BACK ?? BUTTONS.en.BACK, 'backT')],
    ]);

    if (items.length === 0) {
      await ctx.editMessageText(EMPTY[lang] ?? EMPTY.en, {
        reply_markup: keyboard.reply_markup,
        parse_mode: 'HTML',
      });
      return;
    }

    const lines = items.map((r) => {
      const typeEmoji = r.transactionType === TransactionType.INCOME ? '💹' : '🛍️';
      return `${typeEmoji} <b>${r.transactionName}</b> — ${r.amount.toLocaleString('en-US')}   📅 Day ${r.dayOfMonth}`;
    });

    const text = `${HEADER[lang] ?? HEADER.en} (${items.length})\n\n${lines.join('\n')}`;
    await ctx.editMessageText(text, {
      reply_markup: keyboard.reply_markup,
      parse_mode: 'HTML',
    });
  }
}
