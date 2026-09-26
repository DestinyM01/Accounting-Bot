import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReportDataService } from './report-data.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { StatisticsService } from '../statistics/statistics.service';
import { BudgetService } from '../budget/budget.service';
import { CategorySpendService } from '../cash/category-spend.service';
import { ReportPeriod } from './report-periods';
import { queryStub as query } from '../test-utils/query-stub';

const at = (iso: string) => new Date(iso);
const idAt = (d: Date) => Types.ObjectId.createFromTime(Math.floor(d.getTime() / 1000));

const WEEK: ReportPeriod = {
  kind: 'weekly',
  key: '2026-W39',
  from: at('2026-09-21T04:00:00Z'),
  to: at('2026-09-28T04:00:00Z'),
  dueAt: at('2026-09-28T11:00:00Z'),
  expired: false,
};
const NOW = at('2026-09-28T11:20:00Z');

describe('ReportDataService', () => {
  let service: ReportDataService;
  let txModel: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock };
  let recurringModel: { find: jest.Mock };
  let statistics: { summary: jest.Mock; byCategory: jest.Mock };
  let budgets: { get: jest.Mock };
  let spend: { byCategory: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = {
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query({ _id: idAt(at('2026-09-28T09:00:00Z')) })),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    recurringModel = { find: jest.fn().mockResolvedValue([]) };
    statistics = {
      summary: jest.fn().mockResolvedValue({ month: 9, year: 2026, income: 75000, expense: 61200, net: 13800, transactionCount: 40 }),
      byCategory: jest.fn().mockResolvedValue([]),
    };
    budgets = { get: jest.fn().mockResolvedValue([]) };
    spend = { byCategory: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: StatisticsService, useValue: statistics },
        { provide: BudgetService, useValue: budgets },
        { provide: CategorySpendService, useValue: spend },
      ],
    }).compile();
    service = module.get(ReportDataService);
  });

  describe('weekly', () => {
    it('reads only the covered week, spending only', async () => {
      await service.weekly(WEEK, NOW);
      expect(txModel.find).toHaveBeenCalledWith({
        userId: 1,
        timestamp: { $gte: WEEK.from, $lt: WEEK.to },
        ...SPENDING_ONLY,
      });
    });

    it('totals the week, ranks its categories and its largest expenses', async () => {
      txModel.find.mockReturnValue(
        query([
          { amount: -100, category: 'food', transactionName: 'colmado', timestamp: at('2026-09-22T15:00:00Z') },
          { amount: -12000, category: 'housing', transactionName: 'rent co', merchant: 'Rent Co', timestamp: at('2026-09-23T15:00:00Z') },
          { amount: 45000, category: 'salary', transactionName: 'payroll', timestamp: at('2026-09-24T15:00:00Z') },
          { amount: -50, category: 'food', transactionName: 'bakery', timestamp: at('2026-09-25T15:00:00Z') },
          { amount: -300, transactionName: 'misc', timestamp: at('2026-09-26T15:00:00Z') },
        ]),
      );
      spend.byCategory.mockResolvedValueOnce([
        { category: 'housing', total: 12000 },
        { category: 'other', total: 300 },
        { category: 'food', total: 150 },
      ]);
      const { week } = await service.weekly(WEEK, NOW);
      expect(week.spent).toBe(12450);
      expect(week.income).toBe(45000);
      expect(week.topCategories).toEqual([
        { category: 'housing', total: 12000 },
        { category: 'other', total: 300 },
        { category: 'food', total: 150 },
      ]);
      expect(spend.byCategory).toHaveBeenCalledWith(WEEK.from, WEEK.to);
      expect(week.largest).toEqual([
        { name: 'Rent Co', at: at('2026-09-23T15:00:00Z'), amount: 12000 },
        { name: 'misc', at: at('2026-09-26T15:00:00Z'), amount: 300 },
        { name: 'colmado', at: at('2026-09-22T15:00:00Z'), amount: 100 },
      ]);
    });

    it('keeps only the top 5 categories', async () => {
      spend.byCategory.mockResolvedValueOnce(
        ['g', 'f', 'e', 'd', 'c', 'b', 'a'].map((category, i) => ({ category, total: (7 - i) * 10 })),
      );
      const { week } = await service.weekly(WEEK, NOW);
      expect(week.topCategories.map((c) => c.category)).toEqual(['g', 'f', 'e', 'd', 'c']);
    });

    it('counts what is waiting, ignoring deleted rows', async () => {
      txModel.countDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      const { waiting } = await service.weekly(WEEK, NOW);
      expect(txModel.countDocuments).toHaveBeenNthCalledWith(1, { userId: 1, transferKind: 'unresolved', deletedAt: null });
      expect(txModel.countDocuments).toHaveBeenNthCalledWith(2, { userId: 1, categoryNeedsReview: true, deletedAt: null });
      expect(waiting).toEqual({ unresolved: 2, toReview: 1 });
    });

    it('takes the month so far from the same services as the web', async () => {
      budgets.get.mockResolvedValue([
        { category: 'food', limit: 10000, spent: 8000, remaining: 2000, percentage: 80, month: 9, year: 2026 },
      ]);
      const { month } = await service.weekly(WEEK, NOW);
      expect(statistics.summary).toHaveBeenCalledWith();
      expect(budgets.get).toHaveBeenCalledWith();
      expect(month).toEqual({
        monthNumber: 9,
        spent: 61200,
        income: 75000,
        net: 13800,
        budgets: [{ category: 'food', limit: 10000, spent: 8000 }],
      });
    });
  });

  describe('health', () => {
    const gym = (overrides: Record<string, unknown> = {}) => ({
      _id: idAt(at('2026-01-01T00:00:00Z')),
      transactionName: 'gym',
      dayOfMonth: 20,
      lastPeriod: '2026-08',
      ...overrides,
    });

    it('flags a recurring payment more than two hours past due', async () => {
      recurringModel.find.mockResolvedValue([gym()]);
      const h = await service.health(at('2026-09-20T15:00:00Z'));
      expect(recurringModel.find).toHaveBeenCalledWith({ userId: 1, active: true });
      expect(h.overdueRecurring).toEqual([{ name: 'gym', dueAt: at('2026-09-20T12:00:00Z') }]);
    });

    it('does not flag one only an hour past due', async () => {
      recurringModel.find.mockResolvedValue([gym()]);
      expect((await service.health(at('2026-09-20T13:00:00Z'))).overdueRecurring).toEqual([]);
    });

    it('does not flag a month already handled', async () => {
      recurringModel.find.mockResolvedValue([gym({ lastPeriod: '2026-09' })]);
      expect((await service.health(at('2026-09-25T15:00:00Z'))).overdueRecurring).toEqual([]);
    });

    it('still flags a legacy rule whose createdAt field loads as "now"', async () => {
      // Mongoose fills a missing createdAt with "now"; only the ObjectId holds the real creation time.
      recurringModel.find.mockResolvedValue([gym({ createdAt: at('2026-09-20T15:00:00Z') })]);
      const h = await service.health(at('2026-09-20T15:00:00Z'));
      expect(h.overdueRecurring).toEqual([{ name: 'gym', dueAt: at('2026-09-20T12:00:00Z') }]);
    });

    it('is content with a bank email ingested two days ago, deleted rows included', async () => {
      const newest = query({ _id: idAt(at('2026-09-26T11:00:00Z')) });
      txModel.findOne.mockReturnValue(newest);
      const h = await service.health(NOW);
      expect(txModel.findOne).toHaveBeenCalledWith({ userId: 1, source: 'email' });
      expect(h).toMatchObject({ lastIngestedAt: at('2026-09-26T11:00:00Z'), daysSinceIngest: 2, ingestionStale: false });
      expect(newest.sort).toHaveBeenCalledWith({ _id: -1 });
    });

    it('treats a bank email exactly three days old as fresh', async () => {
      txModel.findOne.mockReturnValue(query({ _id: idAt(at('2026-09-25T11:20:00Z')) }));
      expect(await service.health(NOW)).toMatchObject({ daysSinceIngest: 3, ingestionStale: false });
    });

    it('flags ingestion more than three days old', async () => {
      txModel.findOne.mockReturnValue(query({ _id: idAt(at('2026-09-24T11:00:00Z')) }));
      expect(await service.health(NOW)).toMatchObject({ daysSinceIngest: 4, ingestionStale: true });
    });

    it('flags ingestion that never happened', async () => {
      txModel.findOne.mockReturnValue(query(null));
      expect(await service.health(NOW)).toMatchObject({ lastIngestedAt: null, daysSinceIngest: null, ingestionStale: true });
    });
  });

  describe('monthly', () => {
    const month = (from: string): ReportPeriod => ({
      kind: 'monthly',
      key: from.slice(0, 7),
      from: at(from),
      to: at(from),
      dueAt: at(from),
      expired: false,
    });

    it('summarises the covered month against the month before, from the web’s services', async () => {
      statistics.summary
        .mockResolvedValueOnce({ month: 9, year: 2026, income: 75000, expense: 61200, net: 13800, transactionCount: 40 })
        .mockResolvedValueOnce({ month: 8, year: 2026, income: 70000, expense: 54642.9, net: 15357.1, transactionCount: 38 });
      statistics.byCategory.mockResolvedValue([{ category: 'housing', total: 36000 }]);
      const data = await service.monthly(month('2026-09-01T00:00:00Z'));
      expect(statistics.summary).toHaveBeenNthCalledWith(1, 9, 2026);
      expect(statistics.summary).toHaveBeenNthCalledWith(2, 8, 2026);
      expect(statistics.byCategory).toHaveBeenCalledWith(9, 2026);
      expect(budgets.get).toHaveBeenCalledWith(9, 2026);
      expect(data).toEqual({
        month: 9,
        year: 2026,
        income: 75000,
        expense: 61200,
        net: 13800,
        previousExpense: 54642.9,
        categories: [{ category: 'housing', total: 36000 }],
        budgets: [],
      });
    });

    it('compares January with the previous December', async () => {
      await service.monthly(month('2027-01-01T00:00:00Z'));
      expect(statistics.summary).toHaveBeenNthCalledWith(1, 1, 2027);
      expect(statistics.summary).toHaveBeenNthCalledWith(2, 12, 2026);
    });
  });
});
