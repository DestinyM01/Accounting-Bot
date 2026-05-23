import { Logger } from '@nestjs/common';
import { Action, Ctx, Update } from 'nestjs-telegraf';
import { IContext } from '../type/interface';
import { MAIN_MENU } from '../constants';
import {
  actionButtonsAdmin,
  actionButtonsAnalytics,
  actionButtonsBackSettings,
  actionButtonsSettings,
} from '../battons';
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
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const message = await this.analyticsService.generateReport(yesterday, today, 'for_today', lang);
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
  }

  @Action('for_week')
  async for_week(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_week`);
    const lang = ctx.session.language || 'en';
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    const message = await this.analyticsService.generateReport(weekAgo, today, 'for_week', lang);
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
  }

  @Action('for_month')
  async for_month(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_month`);
    const lang = ctx.session.language || 'en';
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const monthAgo = new Date();
    monthAgo.setMonth(today.getMonth() - 1);
    const message = await this.analyticsService.generateReport(monthAgo, today, 'for_month', lang);
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
  }

  @Action('for_3_month')
  async for_half_a_year(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} for_half_a_year`);
    const lang = ctx.session.language || 'en';
    const today = new Date();
    today.setDate(today.getDate() - 1);
    this.logger.log(today);
    const halfYearAgo = new Date();
    halfYearAgo.setMonth(today.getMonth() - 3);
    const message = await this.analyticsService.generateReport(halfYearAgo, today, 'for_3_month', lang);
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: actionButtonsBackSettings(lang).reply_markup });
  }
}
