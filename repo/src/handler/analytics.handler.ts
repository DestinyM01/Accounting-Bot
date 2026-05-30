import { Logger } from '@nestjs/common';
import { Action, Ctx, Update } from 'nestjs-telegraf';
import { IContext } from '../type/interface';
import { MAIN_MENU } from '../constants';
import {
  actionButtonsAdmin,
  actionButtonsAnalytics,
  actionButtonsBackSettings,
  actionButtonsSettings,
} from '../buttons';
import { AdvancedStatisticsService, AnalyticsService } from '../service';

@Update()
export class AnalyticsHandler {
  private readonly logger: Logger = new Logger(AnalyticsHandler.name);
  constructor(private readonly analyticsService: AnalyticsService) {}
  @Action('bot_analytics')
  async botAnalytics(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} bot_analytics`);
    const lang = ctx.session.language || 'en';
    const INTRO = {
      en: 'Select the analytics period:',
      es: 'Selecciona el período de análisis:',
      ua: 'Оберіть аналітику за потрібний вам період:',
      pl: 'Wybierz okres analityki:',
    };
    await ctx.editMessageText(INTRO[lang] ?? INTRO.en, actionButtonsAnalytics(lang));
  }

  @Action('for_today')
  async for_today(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_today`);
    const lang = ctx.session.language || 'en';
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 1);
      const message = await this.analyticsService.generateReport(startDate, endDate, 'for_today', lang);
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
    } catch (err) {
      this.logger.error(`for_today error`, err);
    }
  }

  @Action('for_week')
  async for_week(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_week`);
    const lang = ctx.session.language || 'en';
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const message = await this.analyticsService.generateReport(startDate, endDate, 'for_week', lang);
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
    } catch (err) {
      this.logger.error(`for_week error`, err);
    }
  }

  @Action('for_month')
  async for_month(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_month`);
    const lang = ctx.session.language || 'en';
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      const message = await this.analyticsService.generateReport(startDate, endDate, 'for_month', lang);
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
    } catch (err) {
      this.logger.error(`for_month error`, err);
    }
  }

  @Action('for_3_month')
  async for_half_a_year(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_3_month`);
    const lang = ctx.session.language || 'en';
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      const message = await this.analyticsService.generateReport(startDate, endDate, 'for_3_month', lang);
      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
    } catch (err) {
      this.logger.error(`for_3_month error`, err);
    }
  }
}
