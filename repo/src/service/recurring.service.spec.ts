import { RecurringService } from './recurring.service';
import { TransactionType } from '../type/enum/transactionType.enam';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Must stay in sync with api's reconciliation.service.ts periodKey() format. */
function periodKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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
      findOneByRecurringPeriod: jest.fn().mockResolvedValue(null),
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
    // Anchored to day 15, which exists in every month, so this can never
    // overflow into the current month. Deriving the day from `now` instead
    // (new Date(y, m - 1, now.getDate())) breaks whenever the previous month
    // is shorter than today's day-of-month: e.g. on 31 Mar,
    // new Date(y, 1, 31) overflows February and lands on 2/3 Mar — the SAME
    // month as "now" — so isSameMonth() would (wrongly) call the rule already
    // executed this month and this test would fail. Also correct across a
    // year boundary: new Date(y, -1, 15) normalises to December of y - 1.
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const rule = makeRule({ lastExecutedAt: lastMonth });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips a rule already satisfied by an ingested transaction this month', async () => {
    const rule = makeRule({ lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });
    mockTransactionService.findOneByRecurringPeriod = jest.fn().mockResolvedValue({ _id: 'existingTx' });

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

  // Without a canonical period stamp, ingestion (which buckets by the payment's
  // own occurredAt month) and the cron (which used to bucket by "now") could
  // land in different months for the same payment near a month boundary, and
  // neither side's lookup would ever find the other's row.
  it('stamps the current period on the transaction it creates', async () => {
    const rule = makeRule({ _id: 'r1', lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

    await service.processRecurring();

    expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ recurringPeriod: periodKey(new Date()) }),
    );
  });

  it('skips a rule already satisfied for this period', async () => {
    const rule = makeRule({ _id: 'r1', lastExecutedAt: undefined });
    mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });
    mockTransactionService.findOneByRecurringPeriod = jest.fn().mockResolvedValue({ _id: 'existingTx' });

    await service.processRecurring();

    expect(mockTransactionService.findOneByRecurringPeriod).toHaveBeenCalledWith(
      rule.userId,
      String(rule._id),
      periodKey(new Date()),
    );
    expect(mockTransactionService.createTransaction).not.toHaveBeenCalled();
  });

  // The tests above compare against periodKey(new Date()) — the same
  // padStart call the production code uses — so they'd pass even if padding
  // were silently broken, and only ever run against whatever month "today"
  // happens to be (January-September, since the suite runs in September
  // 2026). Freezing time to a single-digit and a double-digit month and
  // asserting a literal string exercises the zero-padding independently.
  describe('period zero-padding across the year', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('stamps a single-digit month with a leading zero (January)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15));
      const rule = makeRule({ lastExecutedAt: undefined });
      mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

      await service.processRecurring();

      expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ recurringPeriod: '2026-01' }),
      );
    });

    it('stamps a double-digit month correctly (December)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 11, 15));
      const rule = makeRule({ lastExecutedAt: undefined });
      mockRecurringModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([rule]) });

      await service.processRecurring();

      expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ recurringPeriod: '2026-12' }),
      );
    });
  });
});
