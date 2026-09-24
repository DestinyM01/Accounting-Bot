import { AdvancedStatisticsService } from './advanced.statistics.service';
import { TransactionType } from '../type/enum/transactionType.enam';

// ─────────────────────────────────────────────────────────────────────────────

describe('AdvancedStatisticsService', () => {
  let service: AdvancedStatisticsService;
  let mockTransactionModel: any;
  let mockBalanceModel: any;
  let mockMessageService: any;

  beforeEach(() => {
    mockTransactionModel = jest.fn();
    mockTransactionModel.aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

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
    it('excludes internal and unresolved transfers from the $match stage', async () => {
      await service.getTop10Transaction(1, TransactionType.EXPENSE);

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });

  describe('getTotalPositiveAndNegativeTransactionVolumeForToday', () => {
    it('excludes internal and unresolved transfers from the $match stage', async () => {
      await service.getTotalPositiveAndNegativeTransactionVolumeForToday();

      const pipeline = (mockTransactionModel.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0].$match.transferKind).toEqual({ $nin: ['internal', 'unresolved'] });
    });
  });
});
