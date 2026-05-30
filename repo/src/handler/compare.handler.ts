import { Action, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OpenAiApiService } from '../open-ai-api/open-ai-api.service';
import { CustomCallbackQuery, IContext, Transaction } from '../type/interface';
import { Balance } from '../mongodb/shemas/balance.shemas';
import {
  actionButtonsBeckP,
  actionButtonsBeckPAndRemove,
  actionButtonsGptMenu,
  actionButtonsPremiumMenu,
  actionButtonsStatistics,
  backStartButton,
} from '../buttons';
import {
  BAY_PREMIUM_MENU,
  COMPARE_DELL,
  DELETE_COMPARE_DATA,
  getPremiumMessage,
  GPT_MENU,
  NOT_COMPARE,
} from '../constants';

@Update()
export class CompareHandler {
  private readonly logger: Logger = new Logger(CompareHandler.name);
  constructor(
    private readonly openAiApiService: OpenAiApiService,
    @InjectModel('Transaction') private readonly transactionModel: Model<Transaction>,
    @InjectModel('Balance') private readonly balanceModel: Model<Balance>,
  ) {}

  @Action('compare')
  async compare(ctx: IContext) {
    this.logger.log(`user: ${ctx.from.id} compare`);
    const lang = ctx.session.language || 'en';
    const customCallbackQuery: CustomCallbackQuery = ctx.callbackQuery as CustomCallbackQuery;
    if (!ctx.session.compare) ctx.session.compare = [];
    if (ctx.session.compare.length >= 2) {
      await ctx.editMessageText(
        `${COMPARE_DELL[lang] ?? COMPARE_DELL['en']}`,
        actionButtonsStatistics(lang),
      );
    } else {
      ctx.session.compare.push(customCallbackQuery.message.text + '\n');
      await ctx.editMessageText(
        `${getPremiumMessage(lang, ctx.session.compare.length)} `,
        actionButtonsStatistics(lang),
      );
    }
  }
  @Action('get_compare')
  async get_compare(ctx: IContext) {
    await ctx.editMessageText('💭');
    this.logger.log(`user: ${ctx.from.id} get_compare`);
    const lang = ctx.session.language || 'en';
    const userId = ctx.from.id;

    const [recentTxs, balanceDoc] = await Promise.all([
      this.transactionModel.find({ userId }).sort({ timestamp: -1 }).limit(30).lean().exec(),
      this.balanceModel.findOne({ userId }).lean().exec(),
    ]);

    const txSummary = recentTxs
      .map((t) => `${new Date(t.timestamp).toISOString().slice(0, 10)} ${t.transactionName} ${t.transactionType} ${t.amount} (${t.category ?? 'other'})`)
      .join('\n');
    const currentBalance = balanceDoc?.balance ?? 0;

    const message = await this.openAiApiService.generateResponse([
      {
        role: 'user',
        content: `You are a personal finance advisor. Answer in ${lang} language.\n\nUser's current balance: ${currentBalance}\n\nLast 30 transactions:\n${txSummary}\n\nNow compare these two financial periods and give concrete, actionable advice:\n\nPeriod 1:\n${ctx.session.compare[0]}\nPeriod 2:\n${ctx.session.compare[1]}`,
      },
    ]);
    // Telegram has a 4096-char limit — truncate if needed
    const truncated = message.length > 4000 ? message.slice(0, 3997) + '...' : message;
    await ctx.editMessageText(truncated, {
      parse_mode: 'HTML',
      reply_markup: backStartButton().reply_markup,
    });
    ctx.session.compare = [];
  }
  @Action('see_compare')
  async see_compare(ctx: IContext) {
    this.logger.log(`user: ${ctx.from.id} see_compare`);
    if (!ctx.session.compare) ctx.session.compare = [];
    const message = ctx.session.compare;
    if (message[0] === undefined) {
      await ctx.editMessageText(`${NOT_COMPARE[ctx.session.language || 'en']}`, {
        parse_mode: 'HTML',
        reply_markup: actionButtonsBeckP(ctx.session.language).reply_markup,
      });
    } else {
      await ctx.editMessageText(`${message[0]}\n${message[1]}`, {
        parse_mode: 'HTML',
        reply_markup: actionButtonsBeckPAndRemove(ctx.session.language || 'en').reply_markup,
      });
    }
  }

  @Action('gpt')
  async gpt(ctx: IContext) {
    this.logger.log(`user: ${ctx.from.id} gpt`);
    await ctx.editMessageText(`${GPT_MENU[ctx.session.language || 'en']}`, {
      parse_mode: 'HTML',
      reply_markup: actionButtonsGptMenu(ctx.session.language).reply_markup,
    });
  }
  @Action('backP')
  async backP(ctx: IContext) {
    this.logger.log(`user: ${ctx.from.id} gpt`);
    await ctx.editMessageText(`${BAY_PREMIUM_MENU[ctx.session.language || 'en']}`, {
      reply_markup: actionButtonsPremiumMenu(ctx.session.language).reply_markup,
      disable_web_page_preview: true,
      parse_mode: 'HTML',
    });
  }
  @Action('compare_remove')
  async compare_remove(ctx: IContext) {
    this.logger.log(`user: ${ctx.from.id} compare_remove`);
    ctx.session.compare = [];
    await ctx.editMessageText(`${DELETE_COMPARE_DATA[ctx.session.language || 'en']}`, {
      reply_markup: actionButtonsPremiumMenu(ctx.session.language).reply_markup,
      disable_web_page_preview: true,
      parse_mode: 'HTML',
    });
  }
}
