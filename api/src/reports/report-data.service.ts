import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { NOT_DELETED, SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { StatisticsService } from '../statistics/statistics.service';
import { BudgetService } from '../budget/budget.service';
import { CategorySpendService } from '../cash/category-spend.service';
import { planOccurrences, schedulableFrom } from '../recurring/due-occurrences';
import { ReportPeriod } from './report-periods';
import { BudgetLine, CategoryTotal, Health, MonthlyReportData, RecurringProblem, WeeklyReportData } from './report-types';

/** A due occurrence counts as overdue after two missed hourly sweeps. */
export const OVERDUE_AFTER_HOURS = 2;
/** No bank email ingested for longer than this is reported. */
export const INGESTION_STALE_DAYS = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const round2 = (n: number) => Math.round(n * 100) / 100;
const toBudgetLines = (rows: { category: string; limit: number; spent: number }[]): BudgetLine[] =>
  rows.map((b) => ({ category: b.category, limit: b.limit, spent: b.spent }));

/**
 * Everything a report says. Monthly figures come from the same services as the
 * web, so the email and the dashboard can never disagree.
 */
@Injectable()
export class ReportDataService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    private readonly statistics: StatisticsService,
    private readonly budgets: BudgetService,
    private readonly spend: CategorySpendService,
  ) {}

  async weekly(period: ReportPeriod, now: Date): Promise<WeeklyReportData> {
    const txs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: period.from, $lt: period.to }, ...SPENDING_ONLY })
      .select('amount transactionName merchant timestamp')
      .lean();

    const expenses = txs.filter((t) => t.amount < 0);
    const spent = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
    const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    // Itemized cash counts under its categories (see CategorySpendService); the week's total is unchanged.
    const topCategories: CategoryTotal[] = (await this.spend.byCategory(period.from, period.to)).slice(0, 5);
    const largest = [...expenses]
      .sort((a, b) => a.amount - b.amount) // most negative first
      .slice(0, 3)
      .map((t) => ({ name: t.merchant || t.transactionName, at: t.timestamp, amount: round2(Math.abs(t.amount)) }));

    const [summary, budgetRows, unresolved, toReview, health] = await Promise.all([
      this.statistics.summary(),
      this.budgets.get(),
      this.txModel.countDocuments({ userId: this.userId, transferKind: 'unresolved', ...NOT_DELETED }),
      this.txModel.countDocuments({ userId: this.userId, categoryNeedsReview: true, ...NOT_DELETED }),
      this.health(now),
    ]);

    return {
      from: period.from,
      to: period.to,
      week: { spent: round2(spent), income: round2(income), topCategories, largest },
      month: {
        label: MONTHS[summary.month - 1],
        spent: summary.expense,
        income: summary.income,
        net: summary.net,
        budgets: toBudgetLines(budgetRows),
      },
      waiting: { unresolved, toReview },
      health,
    };
  }

  async monthly(period: ReportPeriod): Promise<MonthlyReportData> {
    const month = period.from.getUTCMonth() + 1;
    const year = period.from.getUTCFullYear();
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;

    const [summary, previous, categories, budgetRows] = await Promise.all([
      this.statistics.summary(month, year),
      this.statistics.summary(previousMonth, previousYear),
      this.statistics.byCategory(month, year),
      this.budgets.get(month, year),
    ]);

    return {
      month,
      year,
      income: summary.income,
      expense: summary.expense,
      net: summary.net,
      previousExpense: previous.expense,
      categories,
      budgets: toBudgetLines(budgetRows),
    };
  }

  async health(now: Date): Promise<Health> {
    const checkAt = new Date(now.getTime() - OVERDUE_AFTER_HOURS * HOUR_MS);
    const rules = await this.recurringModel.find({ userId: this.userId, active: true });
    const overdueRecurring: RecurringProblem[] = [];
    for (const rule of rules) {
      const { due } = planOccurrences(schedulableFrom(rule), checkAt);
      if (due.length > 0) overdueRecurring.push({ name: rule.transactionName, dueAt: due[0].dueAt });
    }

    // Freshness is about the pipe, not the row: deleted email rows still count.
    const newest = await this.txModel
      .findOne({ userId: this.userId, source: 'email' })
      .sort({ _id: -1 })
      .select('_id')
      .lean();
    const lastIngestedAt = newest ? (newest._id as Types.ObjectId).getTimestamp() : null;
    const age = lastIngestedAt ? now.getTime() - lastIngestedAt.getTime() : null;

    return {
      overdueRecurring,
      lastIngestedAt,
      daysSinceIngest: age === null ? null : Math.floor(age / DAY_MS),
      ingestionStale: age === null || age > INGESTION_STALE_DAYS * DAY_MS,
    };
  }
}
