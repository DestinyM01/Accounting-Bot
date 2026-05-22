import { Logger } from '@nestjs/common';
import { Action, Ctx, Update } from 'nestjs-telegraf';
import { TransactionType } from '../type/enum/transactionType.enam';
import { ChartService, StatisticsService } from '../service';
import {
  PERIOD_NULL,
  SELECT_CATEGORY_MESSAGE,
  SELECT_DAY_MESSAGE,
  SELECT_MONTH_MESSAGE,
  SELECT_YEAR_MESSAGE,
  WANT_STATISTICS_MESSAGE,
} from '../constants';
import { CustomCallbackQuery, IContext } from '../type/interface';
import {
  actionButtonsDays,
  actionButtonsMonths,
  actionButtonsStatistics,
  actionButtonsTransactionNames,
  actionButtonsYears,
  backStatisticButton,
  categoryChartMenuButtons,
  categoryChartYearButtons,
  categoryChartMonthButtons,
} from '../battons';
import { resetSession } from '../common/reset.session';
import { WizardContext } from 'telegraf/typings/scenes';
import { sendSplitMessage } from '../common';

@Update()
export class StatisticsHandler {
  private readonly logger: Logger = new Logger(StatisticsHandler.name);
  constructor(
    private readonly statisticsService: StatisticsService,
    private readonly chartService: ChartService,
  ) {}

  @Action('statistics')
  async statisticsCommand(ctx: IContext) {
    await ctx.editMessageText(
      WANT_STATISTICS_MESSAGE[ctx.session.language || 'en'],
      actionButtonsStatistics(ctx.session.language || 'en'),
    );
    this.logger.log(`user:${ctx.from.id} statistics command executed`);
  }

  @Action('my_income')
  async incomeListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} my_income command executed`);
    const message = await this.statisticsService.getTransactionsByType(ctx, TransactionType.INCOME);
    await sendSplitMessage(message, ctx);
  }

  @Action('my_expense')
  async expenseListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} my_expense command executed`);
    const message = await this.statisticsService.getTransactionsByType(ctx, TransactionType.EXPENSE);
    await sendSplitMessage(message, ctx);
  }
  @Action('by_category')
  async categoryListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} by_category`);
    const uniqueTransactionNames = await this.statisticsService.getUniqueTransactionNames(ctx);
    if (uniqueTransactionNames === null) {
      await ctx.editMessageText(PERIOD_NULL[ctx.session.language], backStatisticButton(ctx.session.language || 'en'));
      return;
    }
    const transactionNameButtons = actionButtonsTransactionNames(uniqueTransactionNames, ctx.session.language);
    await ctx.editMessageText(SELECT_CATEGORY_MESSAGE[ctx.session.language || 'en'], transactionNameButtons);
  }

  @Action(/TransactionName:(.+)/)
  async transactionNameCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} transactionName command executed`);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      const selectedTransactionName = parts[1];
      const message = await this.statisticsService.getTransactionsByTransactionName(ctx, selectedTransactionName);
      await sendSplitMessage(message, ctx);
    } else {
      this.logger.log('callbackQuery is undefined');
    }
  }
  @Action('today')
  async todayListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} today command executed`);
    const message = await this.statisticsService.getFormattedTransactionsForToday(ctx);
    await sendSplitMessage(message, ctx);
  }
  @Action('on_week')
  async weekListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} week command executed`);
    const message = await this.statisticsService.getFormattedTransactionsForWeek(ctx);
    await sendSplitMessage(message, ctx);
  }
  @Action('on_month')
  async monthListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} month command executed`);
    const message = await this.statisticsService.getFormattedTransactionsForMonth(ctx);
    await sendSplitMessage(message, ctx);
  }

  @Action('select_year')
  async yearListMenuCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} year menu command executed`);
    const uniqueYears = await this.statisticsService.getUniqueYears(ctx.from.id, ctx.session.group);
    const yearButtons = actionButtonsYears(uniqueYears, ctx.session.language);
    await ctx.editMessageText(SELECT_YEAR_MESSAGE[ctx.session.language || 'en'], yearButtons);
  }

  @Action(/Year:(.+)/)
  async specificYearListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} specific year command executed`);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      ctx.session.selectedYear = Number(parts[1]);
      await this.monthListMenuCommand(ctx);
    } else {
      this.logger.log(`user:${ctx.from.id} callbackQuery is undefined`);
    }
  }
  @Action('select_month')
  async monthListMenuCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} month menu command executed`);
    const availableMonths = await this.statisticsService.getUniqueMonths(
      ctx.session.selectedYear,
      ctx.from.id,
      ctx.session.group,
    );
    await ctx.editMessageText(
      SELECT_MONTH_MESSAGE[ctx.session.language || 'en'],
      actionButtonsMonths(ctx.session.language, ctx.session.selectedYear, availableMonths),
    );
  }

  @Action(/selectedDate:(\d+)(?::(\d+))?/)
  async handleSelectedDate(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} selectedDate command executed`);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.match(/selectedDate:(\d+)(?::(\d+))?/);
      if (parts) {
        const selectedYear = Number(parts[1]);
        const selectedMonth = parts[2] ? Number(parts[2]) : null;
        if (selectedMonth === null) {
          const fromDate = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
          const toDate = new Date(selectedYear + 1, 0, 1, 0, 0, 0, 0);
          const message = await this.statisticsService.getTransactionsByPeriod(ctx, fromDate, toDate);
          await sendSplitMessage(message, ctx);
        } else {
          const fromDate = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0);
          const toDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
          const message = await this.statisticsService.getTransactionsByPeriod(ctx, fromDate, toDate);
          await sendSplitMessage(message, ctx);
        }
      } else {
        this.logger.log(`user:${ctx.from.id} Failed to parse callbackData`);
      }
    } else {
      this.logger.log(`user:${ctx.from.id} callbackQuery is undefined`);
    }
  }

  @Action(/Day:(\d+):(\d+):(\d+)/)
  async specificDayListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} specific Day command executed`);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      const selectedYear = Number(parts[1]);
      const selectedMonth = Number(parts[2]);
      const selectedDay = Number(parts[3]);
      ctx.session.selectedYear = selectedYear;
      ctx.session.selectedMonth = selectedMonth;
      ctx.session.selectedDate = selectedDay;
      const fromDate = new Date(selectedYear, selectedMonth - 1, selectedDay, 0, 0, 0, 0);
      const toDate = new Date(selectedYear, selectedMonth - 1, selectedDay, 23, 59, 59, 999);
      const message = await this.statisticsService.getTransactionsByPeriod(ctx, fromDate, toDate);
      await sendSplitMessage(message, ctx);
    } else {
      this.logger.log(`user:${ctx.from.id} callbackQuery is undefined`);
    }
  }
  @Action(/Month:(\d+):(\d+)/)
  async specificMonthListCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} specific month command executed`);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      const selectedYear = Number(parts[1]);
      const selectedMonth = Number(parts[2]);
      const availableDays = await this.statisticsService.getUniqueDays(
        selectedYear,
        selectedMonth,
        ctx.from.id,
        ctx.session.group,
      );
      ctx.session.selectedYear = selectedYear;
      ctx.session.selectedMonth = selectedMonth;
      await ctx.editMessageText(
        SELECT_DAY_MESSAGE[ctx.session.language || 'en'],
        actionButtonsDays(ctx.session.language, selectedYear, selectedMonth, availableDays),
      );
    } else {
      this.logger.log(`user:${ctx.from.id} callbackQuery is undefined`);
    }
  }

  @Action(/details:(\d+):(\d+):(\d+)/)
  async detailsCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} detailsCommand `);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      const year = Number(parts[1]);
      const month = Number(parts[2]);
      const date = Number(parts[3]);
      await this.statisticsService.getDetailedTransactions(ctx, year, month, date);
    } else {
      this.logger.log(`user:${ctx.from.id} callbackQuery is undefined`);
    }
  }
  @Action(/NextPage:(\d+)/)
  async nextPageCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} nextPageCommand `);
    const uniqueTransactionNames = await this.statisticsService.getUniqueTransactionNames(ctx);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const parts = callbackData.split(':');
      const page = Number(parts[1]);
      const transactionNameButtons = actionButtonsTransactionNames(uniqueTransactionNames, ctx.session.language, page);
      await ctx.editMessageText(SELECT_CATEGORY_MESSAGE[ctx.session.language || 'en'], transactionNameButtons);
    }
  }

  // ── Category chart — period picker ──────────────────────────────────────

  @Action('category_chart')
  async categoryChartCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} category_chart menu`);
    const lang = ctx.session.language || 'en';
    const prompt = {
      en: '📊 <b>Category Chart</b>\nSelect a period:',
      es: '📊 <b>Gráfico por Categoría</b>\nSelecciona un período:',
    };
    await ctx.editMessageText(prompt[lang] ?? prompt.en, {
      parse_mode: 'HTML',
      reply_markup: categoryChartMenuButtons(lang).reply_markup,
    });
  }

  @Action('cat_chart_now')
  async catChartNow(ctx: IContext) {
    const now = new Date();
    await this.sendCategoryChart(ctx, now.getFullYear(), now.getMonth() + 1);
  }

  @Action('cat_chart_prev')
  async catChartPrev(ctx: IContext) {
    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();
    await this.sendCategoryChart(ctx, year, month);
  }

  @Action('cat_chart_years')
  async catChartYears(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const years = await this.statisticsService.getUniqueYears(ctx.from.id, ctx.session.group);
    await ctx.editMessageText('📅 Select a year:', categoryChartYearButtons(years, lang));
  }

  @Action(/cat_chart_y:(\d+)/)
  async catChartYear(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const data = (ctx.callbackQuery as CustomCallbackQuery).data;
    const year = Number(data.split(':')[1]);
    const months = await this.statisticsService.getUniqueMonths(year, ctx.from.id, ctx.session.group);
    await ctx.editMessageText(`📅 Select a month for ${year}:`, categoryChartMonthButtons(year, months, lang));
  }

  @Action(/cat_chart_m:(\d+):(\d+)/)
  async catChartMonth(ctx: IContext) {
    const data = (ctx.callbackQuery as CustomCallbackQuery).data;
    const parts = data.match(/cat_chart_m:(\d+):(\d+)/);
    await this.sendCategoryChart(ctx, Number(parts[1]), Number(parts[2]));
  }

  private async sendCategoryChart(ctx: IContext, year: number, month: number) {
    const lang = ctx.session.language || 'en';
    await ctx.answerCbQuery();
    try {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      const totals = await this.statisticsService.getCategoryExpensesForPeriod(
        ctx.from.id, start, end, ctx.session.group,
      );
      if (Object.keys(totals).length === 0) {
        const noData = {
          en: 'No categorised expenses found for this period.',
          es: 'No se encontraron gastos categorizados para este período.',
        };
        await ctx.reply(noData[lang] ?? noData.en);
        return;
      }
      const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const title = `Expenses by Category — ${MONTHS[month - 1]} ${year}`;
      const chart = await this.chartService.generateCategoryPieChart(totals, title);
      const imageBuffer = Buffer.from(chart, 'base64');
      await ctx.replyWithPhoto({ source: imageBuffer }, {
        caption: `📊 ${title}`,
        reply_markup: backStatisticButton(lang).reply_markup,
      });
    } catch (err) {
      this.logger.error('Error generating category chart', err);
      const errMsg = {
        en: 'Could not generate category chart.',
        es: 'No se pudo generar el gráfico de categorías.',
      };
      await ctx.reply(errMsg[lang] ?? errMsg.en);
    }
  }

  @Action('backS')
  async backS(@Ctx() ctx: IContext & WizardContext) {
    this.logger.log(`user:${ctx.from.id} backS `);
    await resetSession(ctx);
    const callbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (callbackQuery.message.photo) {
      await ctx.deleteMessage();
      await ctx.reply(
        WANT_STATISTICS_MESSAGE[ctx.session.language || 'en'],
        actionButtonsStatistics(ctx.session.language),
      );
    } else {
      await ctx.editMessageText(
        WANT_STATISTICS_MESSAGE[ctx.session.language || 'en'],
        actionButtonsStatistics(ctx.session.language),
      );
    }
  }
}
