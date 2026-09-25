import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StatisticsService } from './statistics.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { CategorySpendService } from '../cash/category-spend.service';

const mockModel = {
  find:   jest.fn(function() { return this; }),
  select: jest.fn(function() { return this; }),
  lean:   jest.fn().mockResolvedValue([]),
};

const spend = { byCategory: jest.fn() };

describe('StatisticsService', () => {
  let service: StatisticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    spend.byCategory.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatisticsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: CategorySpendService, useValue: spend },
      ],
    }).compile();
    service = module.get<StatisticsService>(StatisticsService);
  });

  describe('summary', () => {
    it('excludes deleted rows and internal/unresolved transfers from income/expense totals', async () => {
      await service.summary(8, 2026);
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('monthly', () => {
    it('excludes deleted rows and internal/unresolved transfers for every month queried', async () => {
      await service.monthly();
      expect(mockModel.find).toHaveBeenCalled();
      (mockModel.find.mock.calls as any[][]).forEach(([filter]) => {
        expect(filter).toEqual(expect.objectContaining(SPENDING_ONLY));
      });
    });
  });

  describe('byCategory', () => {
    it("returns CategorySpendService's breakdown for the month asked", async () => {
      spend.byCategory.mockResolvedValueOnce([{ category: 'food', total: 3200 }]);
      expect(await service.byCategory(8, 2026)).toEqual([{ category: 'food', total: 3200 }]);
      expect(spend.byCategory).toHaveBeenCalledWith(new Date(2026, 7, 1), new Date(2026, 8, 1));
    });
  });
});
