import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Analytics } from '../mongodb/shemas/analytics.schemas';
import { BalanceService } from './balance.service';
import { PremiumService } from './premium.service';
import { AdvancedStatisticsService } from './advanced.statistics.service';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class AnalyticsService {
  private readonly logger: Logger = new Logger(AnalyticsService.name);
  constructor(
    @InjectModel('Analytics') private readonly analyticsModel: Model<Analytics>,
    private readonly balanceService: BalanceService,
    private readonly premiumService: PremiumService,
    private readonly advancedStatisticsService: AdvancedStatisticsService,
  ) {}
  @Cron('59 23 * * *', { timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo' })
  async createAnalytics() {
    const allUserCount = await this.balanceService.countAllBalances();
    const activeUsersCount = await this.balanceService.countActiveUsersLast3Days();
    const premiumUsersCount = await this.premiumService.countPremiumUsers();
    const bannedUsersCount = await this.balanceService.countBannedUsers();
    const totalTransactionsCount = await this.advancedStatisticsService.getTotalTransactionsForToday();
    const { totalPositiveTransactionVolume, totalNegativeTransactionVolume } =
      await this.advancedStatisticsService.getTotalPositiveAndNegativeTransactionVolumeForToday();
    this.logger.log({ totalPositiveTransactionVolume, totalNegativeTransactionVolume });
    const analytics = new this.analyticsModel({
      allUserCount,
      activeUsersCount,
      bannedUsersCount,
      premiumUsersCount,
      totalTransactionsCount,
      totalPositiveTransactionVolume,
      totalNegativeTransactionVolume,
    });

    const createAnalytics = await analytics.save();
    this.logger.log(`Analytics saved to ${createAnalytics.day}`);
  }

  private async getAnalyticsByDateRange(startDate: Date, endDate: Date): Promise<Analytics[]> {
    // const startOfDay = new Date(startDate);
    // startOfDay.setUTCHours(0, 0, 0, 0);
    //
    // const endOfDay = new Date(endDate);
    // endOfDay.setUTCHours(23, 59, 59, 999);

    this.logger.log(`startDate: ${startDate} endDate: ${endDate}`);

    const startDateAnalytics = await this.analyticsModel
      .findOne({
        day: {
          $gte: new Date(startDate).setUTCHours(0, 0, 0, 0),
          $lte: new Date(startDate).setUTCHours(23, 59, 59, 999),
        },
      })
      .exec();

    const endDateAnalytics = await this.analyticsModel
      .findOne({
        day: {
          $gte: new Date(endDate).setUTCHours(0, 0, 0, 0),
          $lte: new Date(endDate).setUTCHours(23, 59, 59, 999),
        },
      })
      .exec();

    const analyticsData = [];
    if (startDateAnalytics) {
      analyticsData.push(startDateAnalytics);
    }
    if (endDateAnalytics) {
      analyticsData.push(endDateAnalytics);
    }

    this.logger.log(JSON.stringify(analyticsData));

    return analyticsData;
  }

  async generateReport(startDate: Date, endDate: Date, period: string, language: string = 'en'): Promise<string> {
    const analyticsData = await this.getAnalyticsByDateRange(startDate, endDate);
    const lang = language || 'en';

    const NO_DATA = {
      en: '⛔️ No data available for the selected period.',
      es: '⛔️ No hay datos disponibles para el período seleccionado.',
      ua: '⛔️ Немає даних за вказаний період.',
      pl: '⛔️ Brak danych za wybrany okres.',
    };

    if (analyticsData.length === 0) {
      return NO_DATA[lang] ?? NO_DATA.en;
    }

    const current = analyticsData[0];
    let allUserCountChangeSum = 0;
    let activeUsersCountChangeSum = 0;
    let premiumUsersCountChangeSum = 0;
    let bannedUsersCountChangeSum = 0;
    let totalTransactionsCountChangeSum = 0;

    for (let i = 1; i < analyticsData.length; i++) {
      const previous = analyticsData[i];
      allUserCountChangeSum += current.allUserCount - previous.allUserCount;
      activeUsersCountChangeSum += current.activeUsersCount - previous.activeUsersCount;
      premiumUsersCountChangeSum += current.premiumUsersCount - previous.premiumUsersCount;
      bannedUsersCountChangeSum += current.bannedUsersCount - previous.bannedUsersCount;
      totalTransactionsCountChangeSum += current.totalTransactionsCount - previous.totalTransactionsCount;
    }

    const count = analyticsData.length - 1;
    const fmtChange = (sum: number) => (count === 0 ? 'N/A' : this.formatChange(sum / count));

    const PERIOD_LABELS: Record<string, Record<string, string>> = {
      for_today: { en: 'Today', es: 'Hoy', ua: 'За день', pl: 'Dzisiaj' },
      for_week: { en: 'Last week', es: 'Última semana', ua: 'За тиждень', pl: 'Ostatni tydzień' },
      for_month: { en: 'Last month', es: 'Último mes', ua: 'За місяць', pl: 'Ostatni miesiąc' },
      for_3_month: { en: 'Last 3 months', es: 'Últimos 3 meses', ua: 'За три місяці', pl: 'Ostatnie 3 miesiące' },
    };
    const periodDescription = PERIOD_LABELS[period]?.[lang] ?? PERIOD_LABELS[period]?.en ?? period;

    const LABELS: Record<string, Record<string, string>> = {
      en: {
        header: '📊 Report:',
        period: '📅 Period',
        allUsers: '👥 Total users',
        activeUsers: '🔥 Active users',
        premiumUsers: '💎 Premium users',
        bannedUsers: '🚫 Banned users',
        totalTx: '💸 Total transactions',
      },
      es: {
        header: '📊 Informe:',
        period: '📅 Período',
        allUsers: '👥 Total de usuarios',
        activeUsers: '🔥 Usuarios activos',
        premiumUsers: '💎 Usuarios premium',
        bannedUsers: '🚫 Usuarios bloqueados',
        totalTx: '💸 Total de transacciones',
      },
      ua: {
        header: '📊 Звіт:',
        period: '📅 Період',
        allUsers: '👥 Всього користувачів',
        activeUsers: '🔥 Активні користувачі',
        premiumUsers: '💎 Преміум користувачі',
        bannedUsers: '🚫 Заблоковані користувачі',
        totalTx: '💸 Всього транзакцій',
      },
      pl: {
        header: '📊 Raport:',
        period: '📅 Okres',
        allUsers: '👥 Łączna liczba użytkowników',
        activeUsers: '🔥 Aktywni użytkownicy',
        premiumUsers: '💎 Użytkownicy premium',
        bannedUsers: '🚫 Zablokowani użytkownicy',
        totalTx: '💸 Łączna liczba transakcji',
      },
    };
    const t = LABELS[lang] ?? LABELS.en;

    const report = `${t.header}
${t.period}: ${periodDescription}
${t.allUsers}: ${current.allUserCount} (${fmtChange(allUserCountChangeSum)})
${t.activeUsers}: ${current.activeUsersCount} (${fmtChange(activeUsersCountChangeSum)})
${t.premiumUsers}: ${current.premiumUsersCount} (${fmtChange(premiumUsersCountChangeSum)})
${t.bannedUsers}: ${current.bannedUsersCount} (${fmtChange(bannedUsersCountChangeSum)})
${t.totalTx}: ${current.totalTransactionsCount} (${fmtChange(totalTransactionsCountChangeSum)})`;

    return report.trim();
  }

  private formatChange(change: number): string {
    const roundedChange = Math.round(change);
    return roundedChange >= 0 ? `+${roundedChange}` : `${roundedChange}`;
  }
}
