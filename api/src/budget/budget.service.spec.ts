import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BudgetService } from './budget.service';
import { Budget } from '../shared/schemas/budget.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

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

describe('BudgetService', () => {
  let service: BudgetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: getModelToken(Budget.name), useValue: mockBudgetModel },
        { provide: getModelToken(Transaction.name), useValue: mockTransactionModel },
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
});
