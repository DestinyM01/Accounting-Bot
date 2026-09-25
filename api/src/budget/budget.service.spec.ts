import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { Budget } from '../shared/schemas/budget.schema';
import { CategoriesService } from '../categories/categories.service';
import { CategorySpendService } from '../cash/category-spend.service';

const mockBudgetModel = {
  find:             jest.fn(function() { return this; }),
  lean:             jest.fn().mockResolvedValue([{ category: 'housing', limitAmount: 20000 }]),
  findOneAndUpdate: jest.fn(),
};

const mockCategories = { assertValid: jest.fn().mockResolvedValue(undefined) };
const mockSpend = { byCategory: jest.fn() };

describe('BudgetService', () => {
  let service: BudgetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCategories.assertValid.mockResolvedValue(undefined);
    mockSpend.byCategory.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: getModelToken(Budget.name), useValue: mockBudgetModel },
        { provide: CategoriesService, useValue: mockCategories },
        { provide: CategorySpendService, useValue: mockSpend },
      ],
    }).compile();
    service = module.get<BudgetService>(BudgetService);
  });

  describe('get', () => {
    it("takes each budget's spent from CategorySpendService, for the month asked", async () => {
      mockBudgetModel.lean.mockResolvedValueOnce([
        { category: 'housing', limitAmount: 20000 },
        { category: 'food', limitAmount: 5000 },
      ]);
      mockSpend.byCategory.mockResolvedValueOnce([{ category: 'food', total: 3200 }, { category: 'cash', total: 500 }]);
      const rows = await service.get(8, 2026);
      expect(mockSpend.byCategory).toHaveBeenCalledWith(new Date(2026, 7, 1), new Date(2026, 8, 1));
      expect(rows).toEqual([
        { category: 'housing', limit: 20000, spent: 0, remaining: 20000, percentage: 0, month: 8, year: 2026 },
        { category: 'food', limit: 5000, spent: 3200, remaining: 1800, percentage: 64, month: 8, year: 2026 },
      ]);
    });
  });

  describe('set', () => {
    it('checks the category before writing', async () => {
      await service.set('food', 500, 9, 2026);
      expect(mockCategories.assertValid).toHaveBeenCalledWith('food');
      expect(mockBudgetModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: expect.any(Number), category: 'food', month: 9, year: 2026 },
        { limitAmount: 500 },
        { upsert: true },
      );
    });

    it('writes nothing for an unknown or retired category', async () => {
      mockCategories.assertValid.mockRejectedValueOnce(new BadRequestException('Unknown category: gone'));
      await expect(service.set('gone', 500)).rejects.toThrow(/Unknown category/);
      expect(mockBudgetModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
