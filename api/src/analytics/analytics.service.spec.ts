import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AnalyticsService } from './analytics.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const mockAggregateResult = [
  { _id: 'Netflix',   count: 12, totalAmount: 120 },
  { _id: 'Groceries', count:  8, totalAmount: 400 },
];

const mockChartTxs = [
  { amount: -10, timestamp: new Date('2026-03-15') },
  { amount: -15, timestamp: new Date('2026-03-20') },
  { amount: -10, timestamp: new Date('2026-04-10') },
  { amount: -10, timestamp: new Date('2026-05-05') },
];

const mockModel = {
  aggregate: jest.fn().mockResolvedValue(mockAggregateResult),
  find:      jest.fn(function() { return this; }),
  select:    jest.fn(function() { return this; }),
  lean:      jest.fn().mockResolvedValue(mockChartTxs),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getTop10', () => {
    it('assigns rank starting at 1', async () => {
      const result = await service.getTop10();
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
    });

    it('maps _id to name', async () => {
      const result = await service.getTop10();
      expect(result[0].name).toBe('Netflix');
    });

    it('returns count from aggregate', async () => {
      const result = await service.getTop10();
      expect(result[0].count).toBe(12);
    });

    it('returns totalAmount from aggregate', async () => {
      const result = await service.getTop10();
      expect(result[0].totalAmount).toBe(120);
    });
  });

  describe('getTransactionChart', () => {
    it('returns one entry per distinct month', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result).toHaveLength(3); // mar, apr, may
    });

    it('sorts months chronologically', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result[0].month).toBe('2026-03');
      expect(result[1].month).toBe('2026-04');
      expect(result[2].month).toBe('2026-05');
    });

    it('sums amounts within the same month', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result[0].total).toBe(25); // 10 + 15 from March
    });

    it('uses absolute amounts', async () => {
      const result = await service.getTransactionChart('Netflix');
      result.forEach(p => expect(p.total).toBeGreaterThan(0));
    });
  });
});
