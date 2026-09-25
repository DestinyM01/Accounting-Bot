import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../shared/schemas/balance.schema';
import { StatisticsService } from '../statistics/statistics.service';
import { compoundGrowth, GrowthResult } from './compound-growth';
import { parseGrowthQuery } from './growth-query';

export interface MyNumbers {
  startingAmount: number;
  monthlySavings: number;
  /** The average was ≤ 0 while there was some activity: the page says so instead of silently offering 0. */
  spentMore: boolean;
  months: { month: number; year: number; income: number; expense: number; net: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class CalculatorService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    private readonly statistics: StatisticsService,
  ) {}

  compound(query: Record<string, unknown>): GrowthResult {
    return compoundGrowth(parseGrowthQuery(query));
  }

  /**
   * The user's own starting point: today's balance, and the average saved per
   * month over the 3 complete calendar months before this one, counted the way
   * Statistics counts (server-local months; transfers between own accounts excluded).
   */
  async myNumbers(now: Date = new Date()): Promise<MyNumbers> {
    const months = [3, 2, 1].map((back) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    });
    const [balanceDoc, summaries] = await Promise.all([
      this.balanceModel.findOne({ userId: this.userId }).select('balance').lean(),
      Promise.all(months.map((m) => this.statistics.summary(m.month, m.year))),
    ]);
    const rows = summaries.map((s) => ({ month: s.month, year: s.year, income: s.income, expense: s.expense, net: s.net }));
    const average = rows.reduce((sum, r) => sum + r.net, 0) / rows.length;
    const anyActivity = rows.some((r) => r.income > 0 || r.expense > 0);
    return {
      startingAmount: round2(Math.max(0, balanceDoc?.balance ?? 0)),
      monthlySavings: round2(Math.max(0, average)),
      spentMore: anyActivity && average <= 0,
      months: rows,
    };
  }
}
