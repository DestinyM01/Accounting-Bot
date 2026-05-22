import { BudgetService } from './budget.service';
import { Category } from '../type/enum/category.enum';
import { TransactionType } from '../type/enum/transactionType.enam';

// ─────────────────────────────────────────────────────────────────────────────

describe('BudgetService', () => {
  let service: BudgetService;
  let mockBudgetModel: any;
  let mockTransactionModel: any;

  beforeEach(() => {
    mockBudgetModel = jest.fn();
    mockBudgetModel.findOne = jest.fn();
    mockBudgetModel.find = jest.fn();
    mockBudgetModel.create = jest.fn();

    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn();

    service = new BudgetService(mockBudgetModel as any, mockTransactionModel as any);
  });

  // ── checkBudget ────────────────────────────────────────────────────────────

  describe('checkBudget', () => {
    it('returns null when no budget is set for the category this month', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.checkBudget(1, Category.FOOD);

      expect(result).toBeNull();
      // No need to query transactions if there is no budget
      expect(mockTransactionModel.find).not.toHaveBeenCalled();
    });

    it('returns correct spent total and over=false when under limit', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ limitAmount: 1000 }) });

      // Expenses stored as negative amounts
      const transactions = [{ amount: -200 }, { amount: -300 }];
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transactions) });

      const result = await service.checkBudget(1, Category.FOOD);

      expect(result).toEqual({ limit: 1000, spent: 500, over: false });
    });

    it('sets over=true when spent exceeds the limit', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ limitAmount: 400 }) });

      const transactions = [{ amount: -250 }, { amount: -300 }]; // 550 > 400
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transactions) });

      const result = await service.checkBudget(1, Category.FOOD);

      expect(result).toEqual({ limit: 400, spent: 550, over: true });
    });

    it('uses Math.abs so positive amounts are handled correctly', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ limitAmount: 200 }) });

      // Edge case: amount stored as positive
      const transactions = [{ amount: 90 }];
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transactions) });

      const result = await service.checkBudget(1, Category.FOOD);

      expect(result?.spent).toBe(90);
      expect(result?.over).toBe(false);
    });

    it('queries transactions for the current month only', async () => {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ limitAmount: 500 }) });
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.checkBudget(1, Category.TRANSPORT);

      const txQuery = mockTransactionModel.find.mock.calls[0][0];
      // timestamp range should contain start-of-month and end-of-month
      expect(txQuery.timestamp.$gte).toEqual(new Date(year, month - 1, 1));
      expect(txQuery.transactionType).toBe(TransactionType.EXPENSE);
      expect(txQuery.category).toBe(Category.TRANSPORT);
    });

    it('returns spent=0 and over=false when there are no transactions this month', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ limitAmount: 300 }) });
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      const result = await service.checkBudget(1, Category.HEALTH);

      expect(result).toEqual({ limit: 300, spent: 0, over: false });
    });
  });

  // ── setBudget ──────────────────────────────────────────────────────────────

  describe('setBudget', () => {
    it('updates limitAmount on existing budget and saves it', async () => {
      const existing = {
        limitAmount: 500,
        save: jest.fn().mockResolvedValue({ limitAmount: 800 }),
      };
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.setBudget(1, Category.FOOD, 800);

      expect(existing.limitAmount).toBe(800);
      expect(existing.save).toHaveBeenCalled();
      expect(mockBudgetModel.create).not.toHaveBeenCalled();
    });

    it('creates a new budget document when none exists this month', async () => {
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const created = { userId: 1, category: Category.FOOD, limitAmount: 600 };
      mockBudgetModel.create = jest.fn().mockResolvedValue(created);

      const result = await service.setBudget(1, Category.FOOD, 600);

      expect(mockBudgetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          category: Category.FOOD,
          limitAmount: 600,
        }),
      );
      expect(result).toEqual(created);
    });

    it('stamps the current month and year on a new budget', async () => {
      const now = new Date();
      mockBudgetModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      mockBudgetModel.create = jest.fn().mockResolvedValue({});

      await service.setBudget(1, Category.ENTERTAINMENT, 200);

      expect(mockBudgetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        }),
      );
    });
  });

  // ── getBudgets ─────────────────────────────────────────────────────────────

  describe('getBudgets', () => {
    it('returns budgets for the current month and year', async () => {
      const now = new Date();
      const budgets = [{ category: Category.FOOD, limitAmount: 1000 }];
      mockBudgetModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(budgets) });

      const result = await service.getBudgets(1);

      expect(mockBudgetModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        }),
      );
      expect(result).toEqual(budgets);
    });

    it('returns an empty array when no budgets are set', async () => {
      mockBudgetModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      const result = await service.getBudgets(99);

      expect(result).toEqual([]);
    });
  });
});
