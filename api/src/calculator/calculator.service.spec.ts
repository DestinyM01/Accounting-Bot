import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { CalculatorService } from './calculator.service';
import { Balance } from '../shared/schemas/balance.schema';
import { StatisticsService } from '../statistics/statistics.service';

function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const summary = (month: number, year: number, income: number, expense: number) => ({
  month, year, income, expense, net: Math.round((income - expense) * 100) / 100, transactionCount: 1,
});

describe('CalculatorService', () => {
  let service: CalculatorService;
  let balanceModel: { findOne: jest.Mock };
  let statistics: { summary: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOne: jest.fn(() => query({ balance: 1234.567 })) };
    statistics = { summary: jest.fn(async (m: number, y: number) => summary(m, y, 1000 * m, 500 * m)) };
    const mod = await Test.createTestingModule({
      providers: [
        CalculatorService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: StatisticsService, useValue: statistics },
      ],
    }).compile();
    service = mod.get(CalculatorService);
  });

  it('computes a valid query and refuses an invalid one', () => {
    expect(service.compound({ start: '1000', monthly: '0', rate: '12', years: '1' }).finalBalance).toBe(1126.83);
    expect(() => service.compound({ start: '0', monthly: '0', rate: '12', years: '1' })).toThrow(BadRequestException);
  });

  describe('myNumbers', () => {
    it('averages the 3 complete months before this one, across a year boundary, oldest first', async () => {
      const r = await service.myNumbers(new Date(2026, 0, 15));
      expect(statistics.summary.mock.calls).toEqual([[10, 2025], [11, 2025], [12, 2025]]);
      expect(r.months.map((m) => [m.month, m.year])).toEqual([[10, 2025], [11, 2025], [12, 2025]]);
      expect(r.monthlySavings).toBe(5500); // nets 5000, 5500, 6000
      expect(r.spentMore).toBe(false);
      expect(r.startingAmount).toBe(1234.57);
      expect(balanceModel.findOne).toHaveBeenCalledWith({ userId: 1 });
    });

    it('rounds the average to cents', async () => {
      statistics.summary
        .mockResolvedValueOnce(summary(7, 2026, 100, 0))
        .mockResolvedValueOnce(summary(8, 2026, 100, 0))
        .mockResolvedValueOnce(summary(9, 2026, 100.01, 0));
      expect((await service.myNumbers(new Date(2026, 9, 1))).monthlySavings).toBe(100);
    });

    it('offers 0 when more was spent than earned, and says so', async () => {
      statistics.summary.mockImplementation(async (m: number, y: number) => summary(m, y, 100, 300));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(0);
      expect(r.spentMore).toBe(true);
    });

    it('starts from 0 for a negative balance or none', async () => {
      balanceModel.findOne.mockReturnValueOnce(query({ balance: -50 }));
      expect((await service.myNumbers(new Date(2026, 9, 1))).startingAmount).toBe(0);
      balanceModel.findOne.mockReturnValueOnce(query(null));
      expect((await service.myNumbers(new Date(2026, 9, 1))).startingAmount).toBe(0);
    });

    it('does not claim overspending when there was no activity at all', async () => {
      statistics.summary.mockImplementation(async (m: number, y: number) => summary(m, y, 0, 0));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(0);
      expect(r.spentMore).toBe(false);
    });

    it('uses whole calendar months even late in a month', async () => {
      await service.myNumbers(new Date(2026, 2, 31));
      expect(statistics.summary.mock.calls).toEqual([[12, 2025], [1, 2026], [2, 2026]]);
    });

    it('says more was spent when the average is exactly zero but there was activity', async () => {
      statistics.summary.mockImplementation(async (m: number, y: number) => summary(m, y, 100, 100));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(0);
      expect(r.spentMore).toBe(true);
    });

    it('averages over 3 months even when a month had no activity', async () => {
      statistics.summary
        .mockResolvedValueOnce(summary(7, 2026, 300, 0))
        .mockResolvedValueOnce(summary(8, 2026, 0, 0))
        .mockResolvedValueOnce(summary(9, 2026, 300, 0));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(200);
    });
  });
});
