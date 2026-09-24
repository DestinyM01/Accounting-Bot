import { StatisticsService } from './statistics.service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { NOT_DELETED, SPENDING_ONLY } from '../type/transfer-kind';

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
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      await service.getTransactionsByType(makeCtx(), TransactionType.EXPENSE);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('getFormattedTransactionsForToday (via private getTransactions)', () => {
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      await service.getFormattedTransactionsForToday(makeCtx());

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('getTransactionsForChard', () => {
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      await service.getTransactionsForChard(makeCtx(), {} as any);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('getCategoryExpensesForPeriod', () => {
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      await service.getCategoryExpensesForPeriod(1, new Date(2026, 0, 1), new Date(2026, 0, 31));

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  // The date pickers and the per-day detail list show rows rather than sum
  // them, so internal transfers stay visible — but a soft-deleted row must
  // not offer a year, month or day, and must not appear in the detail.

  describe('getUniqueTransactionNames', () => {
    it('excludes deleted rows', async () => {
      mockTransactionModel.distinct = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.getUniqueTransactionNames(makeCtx());

      const query = (mockTransactionModel.distinct as jest.Mock).mock.calls[0][1];
      expect(query).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });
  });

  describe('getUniqueYears', () => {
    it('excludes deleted rows', async () => {
      await service.getUniqueYears(1);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });
  });

  describe('getUniqueMonths / getUniqueDays', () => {
    beforeEach(() => {
      mockTransactionModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
    });

    it('getUniqueMonths excludes deleted rows', async () => {
      await service.getUniqueMonths(2026, 1);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });

    it('getUniqueDays excludes deleted rows', async () => {
      await service.getUniqueDays(2026, 1, 1);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });
  });

  describe('getDetailedTransactions', () => {
    it('excludes deleted rows', async () => {
      await service.getDetailedTransactions(makeCtx(), 2026, 1, 15);

      const query = (mockTransactionModel.find as jest.Mock).mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });
  });
});
