import { AdvancedStatisticsService } from './advanced.statistics.service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { NOT_DELETED, SPENDING_ONLY } from '../type/transfer-kind';

// ─────────────────────────────────────────────────────────────────────────────

describe('AdvancedStatisticsService', () => {
  let service: AdvancedStatisticsService;
  let mockTransactionModel: any;
  let mockBalanceModel: any;
  let mockMessageService: any;

  beforeEach(() => {
    mockTransactionModel = jest.fn();
    mockTransactionModel.aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockTransactionModel.countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

    mockBalanceModel = jest.fn();
    mockBalanceModel.find = jest.fn();

    mockMessageService = {};

    service = new AdvancedStatisticsService(
      mockTransactionModel as any,
      mockBalanceModel as any,
      mockMessageService as any,
    );
  });

  // Internal transfers post as transactionType EXPENSE with a negative
  // amount — exactly the shape these aggregations sum — so without this
  // exclusion the admin top-10 and daily-volume figures are inflated.

  describe('getTop10Transaction', () => {
    it('excludes deleted rows and internal/unresolved transfers from the $match stage', async () => {
      await service.getTop10Transaction(1, TransactionType.EXPENSE);

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('getTotalPositiveAndNegativeTransactionVolumeForToday', () => {
    it('excludes deleted rows and internal/unresolved transfers from the $match stage', async () => {
      await service.getTotalPositiveAndNegativeTransactionVolumeForToday();

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  // The remaining admin figures count rows, not money: a soft-deleted row is
  // still a row in the collection but must not be counted.

  describe('getTop10TransactionNamesByCount', () => {
    it('excludes deleted rows from the $match stage', async () => {
      await service.getTop10TransactionNamesByCount(1);

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match).toEqual(expect.objectContaining({ userId: 1, ...NOT_DELETED }));
    });
  });

  describe('getTop10TransactionNames', () => {
    it('excludes deleted rows before grouping', async () => {
      await service.getTop10TransactionNames();

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match).toEqual(expect.objectContaining(NOT_DELETED));
    });
  });

  describe('getTop10UsersWithMostTransactions', () => {
    it('excludes deleted rows before grouping', async () => {
      await service.getTop10UsersWithMostTransactions();

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match).toEqual(expect.objectContaining(NOT_DELETED));
    });
  });

  describe('getTotalTransactions', () => {
    it('excludes deleted rows from the today / week / month counts', async () => {
      await service.getTotalTransactions();

      const calls = (mockTransactionModel.countDocuments as jest.Mock).mock.calls;
      expect(calls).toHaveLength(3);
      for (const [filter] of calls) {
        expect(filter).toEqual(expect.objectContaining(NOT_DELETED));
      }
    });
  });
});
