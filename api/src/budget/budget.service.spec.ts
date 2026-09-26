import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, Logger } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { Budget, BudgetSchema } from '../shared/schemas/budget.schema';
import { CategoriesService } from '../categories/categories.service';
import { CategorySpendService } from '../cash/category-spend.service';

const mockBudgetModel = {
  find:             jest.fn(function() { return this; }),
  lean:             jest.fn().mockResolvedValue([{ category: 'housing', limitAmount: 20000 }]),
  findOneAndUpdate: jest.fn(),
  init:             jest.fn().mockResolvedValue(undefined),
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

  describe('set: validation', () => {
    it.each([0, -5, 1e9 + 1, Number.NaN, Infinity, '500' as unknown as number])('refuses a limit of %p with 400', async (limit) => {
      await expect(service.set('food', limit, 9, 2026)).rejects.toThrow(BadRequestException);
      expect(mockBudgetModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([0, 13, 1.5])('refuses month %p with 400', async (month) => {
      await expect(service.set('food', 500, month, 2026)).rejects.toThrow(BadRequestException);
    });

    it.each([1999, 2101, 2026.5])('refuses year %p with 400', async (year) => {
      await expect(service.set('food', 500, 9, year)).rejects.toThrow(BadRequestException);
    });

    it('accepts the edges', async () => {
      await service.set('food', 1e9, 12, 2100);
      await service.set('food', 0.01, 1, 2000);
      expect(mockBudgetModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('set: two saves at once', () => {
    it('updates the row the other save created when the unique index refuses the insert', async () => {
      mockBudgetModel.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));
      await service.set('food', 500, 9, 2026);
      expect(mockBudgetModel.findOneAndUpdate).toHaveBeenLastCalledWith(
        { userId: expect.any(Number), category: 'food', month: 9, year: 2026 },
        { limitAmount: 500 },
      );
    });

    it('rethrows any other error', async () => {
      mockBudgetModel.findOneAndUpdate.mockRejectedValueOnce(new Error('db down'));
      await expect(service.set('food', 500, 9, 2026)).rejects.toThrow('db down');
    });
  });

  it('declares one budget per category and month', () => {
    // Mongoose adds `background: true` to every index's options, so the second
    // element is matched loosely here — same pattern as the other schema specs
    // (e.g. settings.schema.spec.ts, migration.schema.spec.ts).
    expect(BudgetSchema.indexes()).toContainEqual([
      { userId: 1, category: 1, month: 1, year: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('logs when the unique index cannot be built', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockBudgetModel.init.mockRejectedValueOnce(new Error('E11000 duplicate key'));
    service.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unique index on budgets'), expect.any(String));
    error.mockRestore();
  });

  it('shows 0% for a legacy budget with a limit of 0 instead of NaN', async () => {
    mockBudgetModel.lean.mockResolvedValueOnce([{ category: 'food', limitAmount: 0 }]);
    mockSpend.byCategory.mockResolvedValueOnce([{ category: 'food', total: 50 }]);
    const [row] = await service.get(8, 2026);
    expect(row.percentage).toBe(0);
  });
});
