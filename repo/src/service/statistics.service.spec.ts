import { StatisticsService } from './statistics.service';
import { TransactionType } from '../type/enum/transactionType.enam';

/** Minimal IContext mock. */
function makeCtx(userId = 1) {
  return {
    from: { id: userId },
    session: { language: 'en' },
    editMessageText: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('StatisticsService', () => {
  let service: StatisticsService;
  let mockTransactionModel: any;
  let mockMessageService: any;

  beforeEach(() => {
    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    mockMessageService = {
      sendFormattedTransactions: jest.fn().mockResolvedValue([]),
      formatTransaction: jest.fn().mockResolvedValue(''),
    };

    service = new StatisticsService(mockTransactionModel as any, mockMessageService as any);
  });

  // Internal transfers post as transactionType EXPENSE with a negative
  // amount — exactly the shape these queries sum into per-name and grand
  // totals via MessageService.sendFormattedTransactions — so without this
  // exclusion the bot's income/expense/category listings are inflated.

  describe('getTransactionsByType', () => {
    it('excludes internal and unresolved transfers', async () => {
      await service.getTransactionsByType(makeCtx(), TransactionType.EXPENSE);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });

  describe('getFormattedTransactionsForToday (via private getTransactions)', () => {
    it('excludes internal and unresolved transfers', async () => {
      await service.getFormattedTransactionsForToday(makeCtx());

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });

  describe('getTransactionsForChard', () => {
    it('excludes internal and unresolved transfers', async () => {
      await service.getTransactionsForChard(makeCtx(), {} as any);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });

  describe('getCategoryExpensesForPeriod', () => {
    it('excludes internal and unresolved transfers', async () => {
      await service.getCategoryExpensesForPeriod(1, new Date(2026, 0, 1), new Date(2026, 0, 31));

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });
});
