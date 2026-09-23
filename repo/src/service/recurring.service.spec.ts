import { RecurringService } from './recurring.service';
import { TransactionType } from '../type/enum/transactionType.enam';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a mock Recurring document (plain object + a jest.fn() save, as Mongoose docs behave). */
function makeRule(overrides: Partial<any> = {}) {
  return {
    _id: 'r1',
    userId: 1,
    userName: 'Alice',
    transactionName: 'rent',
    transactionType: TransactionType.EXPENSE,
    amount: 800,
    category: 'housing',
    dayOfMonth: new Date().getDate(),
    active: true,
    lastExecutedAt: undefined as Date | undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('RecurringService', () => {
  let service: RecurringService;
  let mockRecurringModel: any;
  let mockTransactionService: any;
  let mockBalanceService: any;

  beforeEach(() => {
    mockRecurringModel = jest.fn();
    mockRecurringModel.find = jest.fn();

    mockTransactionService = {
      createTransaction: jest.fn().mockResolvedValue({ _id: 'tx1' }),
      findOneByRecurringThisMonth: jest.fn().mockResolvedValue(null),
    };

    mockBalanceService = {
      updateBalance: jest.fn().mockResolvedValue(undefined),
    };

    service = new RecurringService(
      mockRecurringModel as any,
      mockTransactionService as any,
      mockBalanceService as any,
    );
  });

  it('creates one transaction for a due rule', async () => {
    const rule = makeRule({ lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not fire twice in the same month', async () => {
    const now = new Date();
    const earlierToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0);
    const rule = makeRule({ lastExecutedAt: earlierToday });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).not.toHaveBeenCalled();
  });

  it('fires again the following month', async () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const rule = makeRule({ lastExecutedAt: lastMonth });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips a rule already satisfied by an ingested transaction this month', async () => {
    const rule = makeRule({ lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });
    mockTransactionService.findOneByRecurringThisMonth = jest.fn().mockResolvedValue({ _id: 'existingTx' });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).not.toHaveBeenCalled();
    // The rule must still be marked as executed, so the cron doesn't retry it tomorrow.
    expect(rule.save).toHaveBeenCalled();
    expect(rule.lastExecutedAt).toBeInstanceOf(Date);
  });

  // Without this, the ingestion-side reconciliation query ({ recurringId, timestamp })
  // can never find the transaction the cron created, so a payment recorded by the
  // cron gets recorded a second time when the bank email arrives.
  it('stamps the recurring rule id on the transaction it creates', async () => {
    const rule = makeRule({ _id: 'r1', lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ recurringId: String(rule._id) }),
    );
  });
});
