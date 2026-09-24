import { CronNotificationsService } from './cron.notifications.service';
import { SPENDING_ONLY } from '../type/transfer-kind';

// ─────────────────────────────────────────────────────────────────────────────

describe('CronNotificationsService', () => {
  let service: CronNotificationsService;
  let mockBot: any;
  let mockBalanceModel: any;
  let mockTransactionModel: any;
  let mockBudgetModel: any;

  beforeEach(() => {
    mockBot = {
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    };

    mockBalanceModel = jest.fn();
    mockBalanceModel.find = jest.fn();
    mockBalanceModel.findOne = jest.fn();

    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn();

    mockBudgetModel = jest.fn();
    mockBudgetModel.find = jest.fn();

    service = new CronNotificationsService(
      mockBot as any,
      mockBalanceModel as any,
      mockTransactionModel as any,
      mockBudgetModel as any,
    );
  });

  // ── monthlySummary ─────────────────────────────────────────────────────────

  describe('monthlySummary', () => {
    it('excludes deleted rows and internal/unresolved transfers from the transactions it sums', async () => {
      mockBalanceModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([{ userId: 1, language: 'en' }]) });
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.monthlySummary();

      const txQuery = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(txQuery).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  // ── proactiveBudgetCheck ────────────────────────────────────────────────────

  describe('proactiveBudgetCheck', () => {
    it('excludes deleted rows and internal/unresolved transfers from the spent calculation', async () => {
      const now = new Date();
      mockBudgetModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { userId: 1, category: 'food', limitAmount: 500, month: now.getMonth() + 1, year: now.getFullYear() },
        ]),
      });
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ userId: 1, language: 'en', isBaned: false }) });
      mockTransactionModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.proactiveBudgetCheck();

      const txQuery = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(txQuery).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });
});
