import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { Budget } from '../shared/schemas/budget.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { CategoriesService } from '../categories/categories.service';

const mockBudgetModel = {
  find:             jest.fn(function() { return this; }),
  lean:             jest.fn().mockResolvedValue([{ category: 'housing', limitAmount: 20000 }]),
  findOneAndUpdate: jest.fn(),
};

const mockTransactionModel = {
  find:   jest.fn(function() { return this; }),
  select: jest.fn(function() { return this; }),
  lean:   jest.fn().mockResolvedValue([]),
};

const mockCategories = { assertValid: jest.fn().mockResolvedValue(undefined) };

describe('BudgetService', () => {
  let service: BudgetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCategories.assertValid.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: getModelToken(Budget.name), useValue: mockBudgetModel },
        { provide: getModelToken(Transaction.name), useValue: mockTransactionModel },
        { provide: CategoriesService, useValue: mockCategories },
      ],
    }).compile();
    service = module.get<BudgetService>(BudgetService);
  });

  describe('get', () => {
    it('excludes deleted rows and internal/unresolved transfers from the spent calculation', async () => {
      await service.get(8, 2026);
      expect(mockTransactionModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
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
