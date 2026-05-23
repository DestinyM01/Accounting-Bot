import { Action, Ctx, On, Update } from 'nestjs-telegraf';
import { BudgetService, ChartService, StatisticsService, TransactionService } from '../service';
import { Logger } from '@nestjs/common';
import { BalanceService } from '../service';
import { Category } from '../type/enum/category.enum';
import { TransactionType } from '../type/enum/transactionType.enam';
import {
  BALANCE_MESSAGE,
  CREATE_TRANSACTION_MESSAGE,
  ENTER_EXPENSE_MESSAGE,
  ENTER_INCOME_MESSAGE,
  getBalanceMessage,
  INVALID_DATA_MESSAGE,
  regex,
  SELECT_CATEGORY_MESSAGE,
  SELECT_TRANSACTION_MESSAGE,
  TRANSACTION_DELETED_MESSAGE,
} from '../constants';
import { CustomCallbackQuery, IContext, MyMessage } from '../type/interface';
import { actionButtonsTransaction, backTranButton, categoryButtons } from '../battons';
import { resetSession } from '../common';
import { WizardContext } from 'telegraf/typings/scenes';
import { ITransactionQuery } from '../type/interface/transaction.query.interface';

@Update()
export class TransactionHandler {
  private readonly logger: Logger = new Logger(TransactionHandler.name);
  constructor(
    private readonly transactionService: TransactionService,
    private readonly balanceService: BalanceService,
    private readonly statisticsService: StatisticsService,
    private readonly chartService: ChartService,
    private readonly budgetService: BudgetService,
  ) {}

  @Action('transactions')
  async aboutCommand(ctx: IContext) {
    delete ctx.session.type;
    this.logger.log(`user:${ctx.from.id} transactions command executed`);
    await ctx.editMessageText(
      SELECT_TRANSACTION_MESSAGE[ctx.session.language || 'en'],
      actionButtonsTransaction(ctx.session.language),
    );
  }
  @Action('income')
  async incomeCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} incomeCommand executed`);
    ctx.session.type = 'income';
    await ctx.editMessageText(ENTER_INCOME_MESSAGE[ctx.session.language || 'en'], {
      reply_markup: backTranButton(ctx.session.language || 'en').reply_markup,
      parse_mode: 'HTML',
    });
  }

  @Action('expense')
  async expenseCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} command executed`);
    ctx.session.type = 'expense';
    await ctx.editMessageText(ENTER_EXPENSE_MESSAGE[ctx.session.language || 'en'], {
      reply_markup: backTranButton(ctx.session.language || 'en').reply_markup,
      parse_mode: 'HTML',
    });
  }
  @Action('delete_last')
  async deleteLastCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} deleteLastCommand `);
    ctx.session.type = 'delete';
    const count = 20;
    await this.transactionService.showLastNTransactionsWithDeleteOption(ctx, count);
  }
  @Action(/delete_(.+)/)
  async handleCallbackQuery(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} handleCallbackQuery`);
    try {
      if (ctx.session.type !== 'delete') {
        return;
      }
      const customCallbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
      if (customCallbackQuery && 'data' in customCallbackQuery) {
        const callbackData = customCallbackQuery.data;
        if (callbackData.startsWith('delete_')) {
          const transactionIdToDelete = callbackData.replace('delete_', '');
          await this.transactionService.deleteTransactionById(ctx, transactionIdToDelete);
          await ctx.editMessageText(
            TRANSACTION_DELETED_MESSAGE[ctx.session.language || 'en'],
            backTranButton(ctx.session.language || 'en'),
          );
          delete ctx.session.type;
        }
      } else {
        this.logger.error(`user:${ctx.from.id} customCallbackQuery is undefined or does not contain data`);
      }
    } catch (error) {
      this.logger.error(`user:${ctx.from.id} Error in handleCallbackQuery:`, error);
    }
  }

  @On('text')
  async textCommand(ctx: IContext, next: () => Promise<void>) {
    // ── Search branch ─────────────────────────────────────────────────────────
    if (ctx.session.type === 'search') {
      const lang = ctx.session.language || 'en';
      const keyword = (ctx.message as MyMessage).text.trim();
      const results = await this.transactionService.searchTransactions(
        ctx.from.id,
        keyword,
        ctx.session.group,
      );
      if (results.length === 0) {
        const noResults = {
          en: `🔍 No transactions found for "<b>${keyword}</b>".`,
          ua: `🔍 Транзакцій не знайдено для "<b>${keyword}</b>".`,
          pl: `🔍 Brak transakcji dla "<b>${keyword}</b>".`,
          es: `🔍 No se encontraron transacciones para "<b>${keyword}</b>".`,
        };
        await ctx.replyWithHTML(noResults[lang] ?? noResults.en, backTranButton(lang));
        return;
      }
      const lines = results.map((t) => {
        const sign = t.amount >= 0 ? '📈' : '📉';
        const date = new Date(t.timestamp).toLocaleDateString('en-US');
        return `${sign} <b>${t.transactionName}</b>  ${Math.abs(t.amount)} — ${date}`;
      });
      const header = { en: `🔍 Results for "<b>${keyword}</b>" (top ${results.length}):`, ua: `🔍 Результати для "<b>${keyword}</b>":`, pl: `🔍 Wyniki dla "<b>${keyword}</b>":`, es: `🔍 Resultados para "<b>${keyword}</b>" (top ${results.length}):` };
      await ctx.replyWithHTML(`${header[lang] ?? header.en}\n\n${lines.join('\n')}`, backTranButton(lang));
      return;
    }

    // ── Normal income/expense branch ──────────────────────────────────────────
    if (ctx.session.type !== 'income' && ctx.session.type !== 'expense') {
      return next(); // not our message — let budget, family, and other handlers try
    }
    const message = ctx.message as MyMessage;
    const userId = ctx.from.id;
    const userName = ctx.from.first_name;
    const text = message.text;
    const transactions = text.split(',').map((t) => t.trim());
    let errorMessageSent = false;
    const transactionMessage = [];
    const transactionNames = [];
    const transactionType = ctx.session.type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE;

    for (const transaction of transactions) {
      const matches = transaction.match(regex); // regex до трех слів
      if (!matches) {
        errorMessageSent = true;
        this.logger.error(`Error creating transaction: no matches:${matches} `);
        continue;
      }
      const transactionName = matches[1].trim().toLowerCase();
      transactionNames.push(transactionName);
      const amount = Number(matches[2]);
      if (!transactionName || isNaN(amount) || amount <= 0) {
        errorMessageSent = true;
        continue;
      }
      try {
        const created = await this.transactionService.createTransaction({
          userId,
          transactionName,
          transactionType,
          amount,
          userName,
        });
        await this.balanceService.updateBalance(userId, amount, transactionType, transactionName, (created as any)._id?.toString());
        transactionMessage.push(await this.statisticsService.getTransactionsByTransactionName(ctx, transactionName));
        if (transactions.length === 1) {
          ctx.session.pendingCategoryTransactionId = (created as any)._id.toString();
        }
      } catch (error) {
        this.logger.error('Error creating transaction:', error);
        errorMessageSent = true;
      }
    }
    if (errorMessageSent) {
      await ctx.replyWithHTML(
        INVALID_DATA_MESSAGE[ctx.session.language || 'en'],
        backTranButton(ctx.session.language || 'en'),
      );
    } else {
      const transactionQueue = {} as ITransactionQuery;
      transactionQueue.userId = userId;
      transactionQueue.transactionName = `${transactionNames[0]}`;

      const transactionForCard = await this.statisticsService.getTransactionsForChard(ctx, transactionQueue);
      const chart = await this.chartService.generateDailyTransactionChart(transactionForCard);
      const imageBuffer = Buffer.from(chart, 'base64');

      const balance = await this.balanceService.getBalance(userId, ctx.session.group);
      const balanceMessage = getBalanceMessage(balance, ctx.session.language || 'en', ctx.session.currency || 'DOP');
      await ctx.replyWithPhoto(
        { source: imageBuffer },
        {
          caption: `${CREATE_TRANSACTION_MESSAGE[ctx.session.language || 'en']}\n${transactionMessage}
      ${BALANCE_MESSAGE[ctx.session.language]}\n${balanceMessage}`,
          reply_markup: backTranButton(ctx.session.language || 'en').reply_markup,
          parse_mode: 'HTML',
        },
      );

      if (ctx.session.pendingCategoryTransactionId) {
        await ctx.reply(
          SELECT_CATEGORY_MESSAGE[ctx.session.language || 'en'],
          categoryButtons(ctx.session.pendingCategoryTransactionId, ctx.session.language || 'en'),
        );
      }
      this.logger.log(`user:${ctx.from.id} textCommand executed`);
    }
    // Do NOT delete ctx.session.type here — user can keep adding
    // transactions of the same type until they press Back.
  }

  @Action(/cat_(.+)_(.+)/)
  async handleCategorySelect(ctx: IContext) {
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const parts = callbackData.split('_');
    const category = parts[1];
    const transactionId = parts.slice(2).join('_');
    if (ctx.session.pendingCategoryTransactionId === transactionId) {
      await this.transactionService.setCategoryById(transactionId, category);
      delete ctx.session.pendingCategoryTransactionId;
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.answerCbQuery('✅');

      // Budget check — only for expense transactions
      if (ctx.session.type === 'expense') {
        try {
          const budgetCheck = await this.budgetService.checkBudget(ctx.from.id, category as Category);
          if (budgetCheck) {
            const lang = ctx.session.language || 'en';
            const pct = Math.round((budgetCheck.spent / budgetCheck.limit) * 100);
            const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
            if (budgetCheck.over) {
              const msg = {
                en: `🚨 <b>Budget exceeded!</b>\n<b>${category}</b>: spent <b>${fmt(budgetCheck.spent)}</b> of limit <b>${fmt(budgetCheck.limit)}</b> (${pct}%)`,
                ua: `🚨 <b>Бюджет перевищено!</b>\n<b>${category}</b>: витрачено <b>${fmt(budgetCheck.spent)}</b> з ліміту <b>${fmt(budgetCheck.limit)}</b> (${pct}%)`,
                pl: `🚨 <b>Budżet przekroczony!</b>\n<b>${category}</b>: wydano <b>${fmt(budgetCheck.spent)}</b> z limitu <b>${fmt(budgetCheck.limit)}</b> (${pct}%)`,
                es: `🚨 <b>¡Presupuesto excedido!</b>\n<b>${category}</b>: gastado <b>${fmt(budgetCheck.spent)}</b> de límite <b>${fmt(budgetCheck.limit)}</b> (${pct}%)`,
              };
              await ctx.reply(msg[lang] ?? msg.en, { parse_mode: 'HTML' });
            } else if (pct >= 80) {
              const msg = {
                en: `⚠️ Budget warning: <b>${pct}%</b> used for <b>${category}</b> (${fmt(budgetCheck.spent)} / ${fmt(budgetCheck.limit)})`,
                ua: `⚠️ Увага: <b>${pct}%</b> бюджету витрачено для <b>${category}</b> (${fmt(budgetCheck.spent)} / ${fmt(budgetCheck.limit)})`,
                pl: `⚠️ Uwaga budżetowa: <b>${pct}%</b> wydane dla <b>${category}</b> (${fmt(budgetCheck.spent)} / ${fmt(budgetCheck.limit)})`,
                es: `⚠️ Alerta de presupuesto: <b>${pct}%</b> usado para <b>${category}</b> (${fmt(budgetCheck.spent)} / ${fmt(budgetCheck.limit)})`,
              };
              await ctx.reply(msg[lang] ?? msg.en, { parse_mode: 'HTML' });
            }
          }
        } catch (e) {
          this.logger.error('Budget check failed:', e);
        }
      }
    } else {
      await ctx.answerCbQuery();
    }
  }

  @Action('search_transactions')
  async searchCommand(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    ctx.session.type = 'search';
    const prompt = {
      en: '🔍 Type a keyword to search your transactions (e.g. <b>rent</b>, <b>food</b>):',
      ua: '🔍 Введіть ключове слово для пошуку транзакцій:',
      pl: '🔍 Wpisz słowo kluczowe, aby wyszukać transakcje:',
      es: '🔍 Escribe una palabra clave para buscar tus transacciones (ej. <b>alquiler</b>):',
    };
    await ctx.editMessageText(prompt[lang] ?? prompt.en, {
      parse_mode: 'HTML',
      reply_markup: backTranButton(lang).reply_markup,
    });
  }

  @Action('set_recurring')
  async setRecurring(@Ctx() ctx: IContext & WizardContext) {
    this.logger.log(`user:${ctx.from.id} entering set_recurring scene`);
    await ctx.scene.enter('set_recurring');
  }

  @Action('backT')
  async backT(@Ctx() ctx: IContext & WizardContext) {
    this.logger.log(`user:${ctx.from.id} backT executed`);
    const callbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    await resetSession(ctx);
    try {
      if (callbackQuery.message.photo) {
        await ctx.deleteMessage();
        await ctx.reply(
          SELECT_TRANSACTION_MESSAGE[ctx.session.language || 'en'],
          actionButtonsTransaction(ctx.session.language || 'en'),
        );
      } else {
        await ctx.editMessageText(
          SELECT_TRANSACTION_MESSAGE[ctx.session.language || 'en'],
          actionButtonsTransaction(ctx.session.language || 'en'),
        );
      }
    } catch (error) {
      this.logger.error(`Error in backT: ${error.message}`);
      await ctx.reply(
        SELECT_TRANSACTION_MESSAGE[ctx.session.language || 'en'],
        actionButtonsTransaction(ctx.session.language || 'en'),
      );
    }
  }
}
