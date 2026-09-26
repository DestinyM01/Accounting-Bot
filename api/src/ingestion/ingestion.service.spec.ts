import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';

// @nestjs/schedule ships ESM-only and isn't part of what this unit test
// exercises (no cron scheduler runs in a unit test) — stub the decorator so
// Jest never has to transform that package.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
}));

// Only the popular parser is mocked — it stands in for "the matched parser" in
// every test. The other three parsers are left as their real implementations;
// their real sender addresses never collide with the fake one used below, so
// they never match a mail in these tests.
jest.mock('./parsers/popular.parser', () => ({
  popularParser: {
    bank: 'popular',
    senders: ['popular@bank.com'],
    parse: jest.fn(),
  },
}));

import { IngestionService } from './ingestion.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { Recurring } from '../shared/schemas/recurring.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { MailClient, FetchedMail } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';
import { popularParser } from './parsers/popular.parser';
import { ParsedTransaction } from './parsers/types';
import { SettingsService } from '../settings/settings.service';
import { IngestionStatusService } from './ingestion-status.service';
import { MerchantMemoryService } from '../merchants/merchant-memory.service';

const parserParseMock = popularParser.parse as jest.Mock;

/** A run's counts, zero unless named. */
const counts = (over: Partial<Record<'created' | 'alreadyBooked' | 'notTransactions' | 'unreadable' | 'bookingFailed' | 'unverified', number>> = {}) => ({
  created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0, ...over,
});

function makeParsed(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    bank: 'popular',
    direction: 'expense',
    amount: 100,
    currency: 'DOP',
    occurredAt: new Date('2026-01-01'),
    counterparty: 'Test Merchant',
    isWithdrawal: false,
    approved: true,
    ...overrides,
  };
}

function makeMail(overrides: Partial<FetchedMail> = {}): FetchedMail {
  return {
    messageId: 'msg-1',
    sender: 'popular@bank.com',
    subject: 'Test subject',
    body: 'Test body',
    receivedAt: new Date('2026-01-01'),
    arrivedAt: new Date('2026-01-01'),
    verified: true,
    ...overrides,
  };
}

describe('IngestionService', () => {
  let service: IngestionService;
  let txModel: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    updateOne: jest.Mock;
    deleteOne: jest.Mock;
  };
  let ledger: { apply: jest.Mock; reverse: jest.Mock };
  let categories: { list: jest.Mock };
  let recurringModel: { find: jest.Mock };
  let mail: { fetchSince: jest.Mock };
  let categorizer: { categorize: jest.Mock };
  let fx: { usdToDop: jest.Mock };
  let settings: { accounts: jest.Mock };
  let status: {
    dismissedAmong: jest.Mock; recordUnreadable: jest.Mock; clearUnreadable: jest.Mock; clearUnreadableMany: jest.Mock; recordRun: jest.Mock; recordFailure: jest.Mock; forgetUnreadableBefore: jest.Mock;
    windowStart: jest.Mock; recordResumePoint: jest.Mock; oldestPendingUnreadable: jest.Mock;
  };
  let memory: { all: jest.Mock };
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env.BOSS_USER_ID = '999';

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    txModel = {
      create: jest.fn().mockImplementation((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc })),
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      // The already-ingested lookup: find(...).select(...).lean() -> rows.
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    };
    // The ledger is the only thing that moves the balance; ingestion just
    // hands it the signed delta. Its own behaviour is covered in
    // ledger.service.spec.ts.
    ledger = {
      apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }),
      reverse: jest.fn(),
    };
    categories = {
      list: jest.fn().mockResolvedValue([{ name: 'food' }, { name: 'other' }, { name: 'Gym' }]),
    };
    recurringModel = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };

    mail = { fetchSince: jest.fn().mockResolvedValue([]) };
    categorizer = { categorize: jest.fn().mockResolvedValue({ category: 'food', needsReview: false }) };
    fx = { usdToDop: jest.fn().mockImplementation((amt: number) => Promise.resolve(amt * 60)) };
    settings = { accounts: jest.fn().mockResolvedValue({ cash: [], senders: [] }) };
    status = {
      dismissedAmong: jest.fn().mockResolvedValue(new Set()),
      recordUnreadable: jest.fn().mockResolvedValue(undefined),
      clearUnreadable: jest.fn().mockResolvedValue(undefined),
      clearUnreadableMany: jest.fn().mockResolvedValue(undefined),
      recordRun: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      forgetUnreadableBefore: jest.fn().mockResolvedValue(undefined),
      windowStart: jest.fn().mockResolvedValue(null),
      recordResumePoint: jest.fn().mockResolvedValue(undefined),
      oldestPendingUnreadable: jest.fn().mockResolvedValue(null),
    };
    memory = { all: jest.fn().mockResolvedValue(new Map()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: LedgerService, useValue: ledger },
        { provide: CategoriesService, useValue: categories },
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: MailClient, useValue: mail },
        { provide: CategorizerService, useValue: categorizer },
        { provide: FxService, useValue: fx },
        { provide: SettingsService, useValue: settings },
        { provide: IngestionStatusService, useValue: status },
        { provide: MerchantMemoryService, useValue: memory },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
    // Under load Nest's ModuleTokenFactory itself warns ("is taking Xms to
    // serialize") during compile(), above; that would count as this test's
    // own warning or error and flake the exact-count assertions below.
    loggerWarnSpy.mockClear();
    loggerErrorSpy.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The mail client throws when the mailbox cannot be opened. The cron entry
  // point must survive that and shout: an error-level log on every poll until
  // the label is fixed, never a silent empty run.
  it('poll() logs a rejected run() at error level and does not throw', async () => {
    mail.fetchSince.mockRejectedValue(new Error('Cannot open mailbox "Banks": Command failed'));

    await expect(service.poll()).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Ingestion poll failed',
      expect.stringContaining('Cannot open mailbox "Banks"'),
    );
  });

  it('records an expense as a negative signed amount with TransactionType.EXPENSE', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'expense', amount: 100, currency: 'DOP' }));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.amount).toBe(-100);
    expect(created.transactionType).toBe(TransactionType.EXPENSE);
    expect(created.mailTimeLocal).toBe(true);
  });

  it('records income as a positive signed amount with TransactionType.INCOME', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'income', amount: 500, currency: 'DOP' }));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.amount).toBe(500);
    expect(created.transactionType).toBe(TransactionType.INCOME);
  });

  it('stores transactionType via the TransactionType enum (legacy Russian strings), never an english literal', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'expense' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    // The enum's real values are the legacy Russian strings — assert against
    // the enum member, not a literal, so a hardcoded 'expense'/'income' string
    // would fail this test even though it "looks" plausible.
    expect(created.transactionType).toBe(TransactionType.EXPENSE);
    expect(created.transactionType).toBe('Расход');
    expect(created.transactionType).not.toBe('expense');
  });

  it('counts a Mongo duplicate-key error as already booked, not failed, and does not log an error', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());
    txModel.create.mockRejectedValue({ code: 11000 });

    const result = await service.run();

    expect(result).toEqual(counts({ alreadyBooked: 1 }));
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('counts a non-duplicate persist error as a failed booking and logs an error', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());
    txModel.create.mockRejectedValue(new Error('Mongo connection reset'));

    const result = await service.run();

    expect(result).toEqual(counts({ bookingFailed: 1 }));
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('forces income to category "other" with categoryNeedsReview true and never consults the categorizer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'income', counterparty: 'Some Wire Transfer' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.category).toBe('other');
    expect(created.categoryNeedsReview).toBe(true);
    expect(categorizer.categorize).not.toHaveBeenCalled();
  });

  it('books an ATM withdrawal as cash, without review and without asking the categorizer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ isWithdrawal: true, counterparty: 'Cajero Automatico' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.category).toBe('cash');
    expect(created.categoryNeedsReview).toBe(false);
    expect(created.isWithdrawal).toBe(true);
    expect(categorizer.categorize).not.toHaveBeenCalled();
  });

  it('never offers cash to the categorizer for a merchant', async () => {
    categories.list.mockResolvedValue([{ name: 'food' }, { name: 'cash' }, { name: 'other' }]);
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    expect(categorizer.categorize).toHaveBeenCalledWith('Test Merchant', ['food', 'other']);
  });

  it('converts a USD transaction via FxService and preserves the original USD amount/currency', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'expense', amount: 10, currency: 'USD' }));
    fx.usdToDop.mockResolvedValue(600);

    await service.run();

    expect(fx.usdToDop).toHaveBeenCalledWith(10);
    const created = txModel.create.mock.calls[0][0];
    expect(created.amount).toBe(-600);
    expect(created.originalAmount).toBe(10);
    expect(created.originalCurrency).toBe('USD');
  });

  it('hands the ledger a negative delta for an expense while the transaction stores the signed amount', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'expense', amount: 150, currency: 'DOP' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.amount).toBe(-150);
    // A double-negation bug (negating an already-negative signed amount again)
    // would hand the ledger +150 instead of -150 — this must be -150.
    expect(ledger.apply).toHaveBeenCalledWith(-150, 'expense', 'Test Merchant', 'tx-id');
  });

  it('hands the ledger a positive delta for income while the transaction stores the signed amount', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ direction: 'income', amount: 150, currency: 'DOP' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.amount).toBe(150);
    expect(ledger.apply).toHaveBeenCalledWith(150, 'income', 'Test Merchant', 'tx-id');
  });

  it('counts a mail the parser cannot use as unreadable and logs a warning (never silently dropped)', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(null);

    const result = await service.run();

    expect(result).toEqual(counts({ unreadable: 1 }));
    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(txModel.create).not.toHaveBeenCalled();
  });

  it('does not abort the run when a parser throws; remaining mails are still processed', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' }), makeMail({ messageId: 'm2' })]);
    parserParseMock
      .mockImplementationOnce(() => {
        throw new Error('parser exploded');
      })
      .mockImplementationOnce(() => makeParsed());

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1, unreadable: 1 }));
    expect(txModel.create).toHaveBeenCalledTimes(1);
  });

  // The account lists come from Settings (saved on the web, else the server's
  // config); SettingsService owns the parsing, covered in its own spec.
  it('hands the parsers the account lists from SettingsService', async () => {
    settings.accounts.mockResolvedValue({ cash: ['1111'], senders: ['2222', 'SOME NAME'] });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    const callArgs = parserParseMock.mock.calls[0][0];
    expect(callArgs.ownCashAccounts).toEqual(['1111']);
    expect(callArgs.ownIdentifiers).toEqual(['2222', 'SOME NAME']);
  });

  it('skips a mail the user dismissed, before any parsing', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    status.dismissedAmong.mockResolvedValue(new Set(['m1']));

    const result = await service.run();

    expect(result).toEqual(counts({ notTransactions: 1 }));
    expect(status.dismissedAmong).toHaveBeenCalledWith(['m1']);
    expect(parserParseMock).not.toHaveBeenCalled();
  });

  it('puts every mail of a run in exactly one count', async () => {
    mail.fetchSince.mockResolvedValue([
      makeMail({ messageId: 'booked-before' }),
      makeMail({ messageId: 'dismissed' }),
      makeMail({ messageId: 'unknown-sender', sender: 'someone@else.example' }),
      makeMail({ messageId: 'unreadable', body: 'unreadable' }),
      makeMail({ messageId: 'new', body: 'new' }),
      makeMail({ messageId: 'save-fails', body: 'save-fails' }),
    ]);
    // The first find is the already-booked lookup (alreadyIngested).
    txModel.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'booked-before' }]) }),
    });
    status.dismissedAmong.mockResolvedValue(new Set(['dismissed']));
    parserParseMock.mockImplementation(({ body }: { body: string }) => (body === 'unreadable' ? null : makeParsed()));
    txModel.create
      .mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc }))
      .mockRejectedValueOnce(new Error('Mongo connection reset'));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1, alreadyBooked: 1, notTransactions: 2, unreadable: 1, bookingFailed: 1 }));
  });

  it('records a mail no parser could read, so the Settings page can show it', async () => {
    const m = makeMail({ messageId: 'm1' });
    mail.fetchSince.mockResolvedValue([m]);
    parserParseMock.mockReturnValue(null);

    await service.run();

    expect(status.recordUnreadable).toHaveBeenCalledWith(m);
  });

  it('records a mail whose parser threw as unreadable too', async () => {
    const m = makeMail({ messageId: 'm1' });
    mail.fetchSince.mockResolvedValue([m]);
    parserParseMock.mockImplementation(() => {
      throw new Error('parser exploded');
    });

    await service.run();

    expect(status.recordUnreadable).toHaveBeenCalledWith(m);
  });

  it('takes a mail off the unreadable list once it books', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    expect(status.clearUnreadable).toHaveBeenCalledWith('m1');
  });

  it('takes a mail off the unreadable list when it turns out to be booked already', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    parserParseMock.mockReturnValue(makeParsed());
    txModel.create.mockRejectedValue({ code: 11000 });

    await service.run();

    expect(status.clearUnreadable).toHaveBeenCalledWith('m1');
  });

  it('leaves a mail on the unreadable list when booking it fails', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    parserParseMock.mockReturnValue(makeParsed());
    txModel.create.mockRejectedValue(new Error('db down'));

    await service.run();

    expect(status.clearUnreadable).not.toHaveBeenCalled();
  });

  describe('runGuarded', () => {
    it("returns and records the run's counts", async () => {
      mail.fetchSince.mockResolvedValue([]);
      await expect(service.runGuarded()).resolves.toEqual(counts());
      expect(status.recordRun).toHaveBeenCalledWith(counts());
    });

    it('records and rethrows a run that failed as a whole; the cron entry point still never throws', async () => {
      const err = new Error('Cannot open mailbox "Banks"');
      mail.fetchSince.mockRejectedValue(err);
      await expect(service.runGuarded()).rejects.toThrow('Cannot open mailbox');
      expect(status.recordFailure).toHaveBeenCalledWith(err);
      await expect(service.poll()).resolves.toBeUndefined();
    });

    it('returns null while a run is in flight, and says it is running', async () => {
      let release!: () => void;
      mail.fetchSince.mockReturnValue(new Promise<FetchedMail[]>((resolve) => { release = () => resolve([]); }));
      const first = service.runGuarded();
      expect(service.isRunning).toBe(true);
      await expect(service.runGuarded()).resolves.toBeNull();
      release();
      await first;
      expect(service.isRunning).toBe(false);
    });

    // The `running` flag is set in a try and cleared in a `finally`. If the
    // clear were only on the success path, a run that fails as a whole would
    // leave the flag stuck true forever, and every later poll (and any direct
    // caller of runGuarded()) would see "already running" and be skipped.
    it('releases the running flag after a run fails as a whole, so the next run is not skipped', async () => {
      mail.fetchSince.mockRejectedValueOnce(new Error('Cannot open mailbox "Banks"'));

      await expect(service.runGuarded()).rejects.toThrow('Cannot open mailbox');
      expect(service.isRunning).toBe(false);

      mail.fetchSince.mockResolvedValue([]);
      await expect(service.runGuarded()).resolves.toEqual(counts());
    });
  });

  it('skips (without a matching parser) a mail whose sender is not registered to any parser', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ sender: 'unknown@nowhere.com' })]);

    const result = await service.run();

    expect(result).toEqual(counts({ notTransactions: 1 }));
    expect(parserParseMock).not.toHaveBeenCalled();
  });

  it('does not move the balance for an internal transfer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ transferKind: 'internal' }));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.transferKind).toBe('internal');
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  it('does not move the balance for an unresolved transfer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ transferKind: 'unresolved' }));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.transferKind).toBe('unresolved');
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  it('still moves the balance for an external transfer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ transferKind: 'external' }));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    expect(ledger.apply).toHaveBeenCalledWith(-100, 'expense', expect.any(String), expect.any(String));
  });

  it('counts a non-transactional email as not a transaction, and does not warn', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    (popularParser as any).isNonTransactional = jest.fn().mockReturnValue(true);

    const result = await service.run();

    expect(result).toEqual(counts({ notTransactions: 1 }));
    expect(parserParseMock).not.toHaveBeenCalled();
    expect(loggerWarnSpy).not.toHaveBeenCalled();

    delete (popularParser as any).isNonTransactional;
  });

  it('takes a recognised non-transactional mail off the unreadable list too', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    (popularParser as any).isNonTransactional = jest.fn().mockReturnValue(true);

    await service.run();

    expect(status.clearUnreadable).toHaveBeenCalledWith('m1');

    delete (popularParser as any).isNonTransactional;
  });

  it('links an ingested transaction to the recurring rule it satisfies', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(
      // Local-time constructor deliberately, not an ISO string: matchesRule()
      // compares tx.timestamp.getDate() (local) against rule.dayOfMonth, and
      // an ISO string parses as UTC midnight, which shifts a day in
      // timezones behind UTC.
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 1) }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBe(String(rule._id));
  });

  it('upgrades an existing predicted transaction instead of creating a second one', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    const predicted: any = {
      _id: 'predicted-id',
      recurringId: String(rule._id),
      sourceMessageId: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    txModel.findOne.mockResolvedValue(predicted);
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-42' })]);
    parserParseMock.mockReturnValue(
      makeParsed({
        direction: 'expense',
        amount: 100,
        currency: 'DOP',
        occurredAt: new Date(2026, 0, 1),
        counterparty: 'Landlord',
        externalRef: 'ref-abc',
      }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    expect(predicted.save).toHaveBeenCalled();
    expect(predicted.sourceMessageId).toBe('msg-42');
    expect(predicted.merchant).toBe('Landlord');
    expect(predicted.externalRef).toBe('ref-abc');
    expect(txModel.create).not.toHaveBeenCalled();
    // The prediction already moved the balance when it was created by the cron;
    // confirming it in place must not move it a second time.
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  it('keeps isWithdrawal when confirming a predicted recurring transaction in place', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    const predicted: any = {
      _id: 'predicted-id',
      recurringId: String(rule._id),
      sourceMessageId: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    txModel.findOne.mockResolvedValue(predicted);
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-42' })]);
    parserParseMock.mockReturnValue(
      makeParsed({
        direction: 'expense',
        amount: 100,
        currency: 'DOP',
        occurredAt: new Date(2026, 0, 1),
        counterparty: 'Cajero Automatico',
        isWithdrawal: true,
      }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    expect(predicted.save).toHaveBeenCalled();
    expect(predicted.isWithdrawal).toBe(true);
    expect(predicted.mailTimeLocal).toBe(true);
  });

  it('does not swallow a genuine second payment of the same amount in one month', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    txModel.findOne.mockResolvedValue({
      _id: 'existing-id',
      recurringId: String(rule._id),
      sourceMessageId: 'msg-earlier',
      save: jest.fn(),
    });
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-2' })]);
    parserParseMock.mockReturnValue(
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 2) }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    expect(txModel.create).toHaveBeenCalledTimes(1);
    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBeUndefined();
  });

  // A same-amount internal transfer moves no money and must never be treated
  // as the real-world payment a recurring rule predicts. If it were linked,
  // the cron would later find it and skip the rule, and the genuine expense
  // (should the external leg fail to parse or arrive late) would be recorded
  // nowhere.
  it('does not link an internal transfer to a recurring rule', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(
      makeParsed({
        direction: 'expense',
        amount: 100,
        currency: 'DOP',
        occurredAt: new Date(2026, 0, 1),
        transferKind: 'internal',
      }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBeUndefined();
  });

  // Two active rules of the same amount can both match one mail. The old code
  // `break`s on the first match unconditionally, so when that first rule's
  // period is already satisfied by an earlier confirmed payment, the second
  // email falls through to "record separately" — unlinked to ANY rule — and
  // the second rule's own cron still fires later, double-charging it. The
  // fix must instead try the next matching rule when the first one's period
  // is already claimed.
  it('links to the next matching rule when an earlier one is already satisfied this period', async () => {
    const ruleA = {
      _id: 'rule-A',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    const ruleB = {
      _id: 'rule-B',
      userId: 999,
      amount: 100,
      dayOfMonth: 2,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([ruleA, ruleB]) });

    // Rule A's period is already confirmed by an earlier email; rule B's is not.
    txModel.findOne.mockImplementation((query: any) => {
      if (query.recurringId === String(ruleA._id)) {
        return Promise.resolve({
          _id: 'confirmed-A',
          recurringId: String(ruleA._id),
          recurringPeriod: query.recurringPeriod,
          sourceMessageId: 'msg-earlier',
        });
      }
      return Promise.resolve(null);
    });

    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-2' })]);
    parserParseMock.mockReturnValue(
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 1) }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBe(String(ruleB._id));
  });

  // A prediction the user soft-deleted is not there to confirm; the lookup
  // must see only live rows.
  it('looks up the predicted row among live rows only', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 1) }),
    );

    await service.run();

    expect(txModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ recurringId: String(rule._id), ...NOT_DELETED }),
    );
  });

  it('leaves an unmatched transaction unlinked', async () => {
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBeUndefined();
  });

  it('stamps recurringPeriod alongside recurringId', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 1) }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    const created = txModel.create.mock.calls[0][0];
    expect(created.recurringId).toBe(String(rule._id));
    expect(created.recurringPeriod).toBe('2026-01');
  });

  // The old query derived a month range from the mail's own occurredAt
  // (August, for a payment posted Aug 31), while the prediction the cron
  // created lives in September (the occurrence the payment actually
  // satisfies). A timestamp-range lookup rooted in the wrong month would
  // never find it, so the mail would create a second, duplicate row. The
  // period-based lookup finds it regardless of which calendar month either
  // side's timestamp falls in.
  it('finds the predicted transaction by period, not by timestamp range', async () => {
    const rule = {
      _id: 'rule-1',
      userId: 999,
      amount: 100,
      dayOfMonth: 1,
      active: true,
      transactionType: TransactionType.EXPENSE,
    };
    recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });

    const predicted: any = {
      _id: 'predicted-id',
      recurringId: String(rule._id),
      recurringPeriod: '2026-09',
      // Dated in September — outside an August-derived month range — yet it
      // must still be found because it shares the same recurringPeriod.
      timestamp: new Date(2026, 8, 1),
      sourceMessageId: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    txModel.findOne.mockImplementation((query: any) => {
      const matches =
        query.recurringId === String(rule._id) &&
        query.recurringPeriod === '2026-09' &&
        query.timestamp === undefined;
      return Promise.resolve(matches ? predicted : null);
    });

    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-42' })]);
    // Posted Aug 31 — 1 day before the rule's Sep 1 occurrence, so it
    // satisfies the '2026-09' period even though its own calendar month is
    // August.
    parserParseMock.mockReturnValue(
      makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 7, 31) }),
    );

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1 }));
    expect(predicted.save).toHaveBeenCalled();
    expect(predicted.sourceMessageId).toBe('msg-42');
    expect(txModel.create).not.toHaveBeenCalled();
  });

  // If the balance update fails after create() succeeded, the row exists with
  // its unique sourceMessageId: every later poll sees 'duplicate' and the
  // balance is never applied — a permanent drift. The created row must be
  // rolled back so the next poll can retry the whole thing cleanly.
  describe('balance failure after create', () => {
    it('deletes the just-created row and reports failed when the ledger rejects', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-1' })]);
      parserParseMock.mockReturnValue(makeParsed({ direction: 'expense', amount: 100 }));
      ledger.apply.mockRejectedValueOnce(new Error('Mongo write concern timeout'));

      const result = await service.run();

      expect(result).toEqual(counts({ bookingFailed: 1 }));
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.deleteOne).toHaveBeenCalledWith({ _id: 'tx-id' });
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('lets the next poll create the same mail again once the ledger works', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-1' })]);
      parserParseMock.mockReturnValue(makeParsed({ direction: 'expense', amount: 100 }));
      ledger.apply.mockRejectedValueOnce(new Error('transient'));

      const first = await service.run();
      const second = await service.run();

      expect(first).toEqual(counts({ bookingFailed: 1 }));
      expect(second).toEqual(counts({ created: 1 }));
      expect(txModel.create).toHaveBeenCalledTimes(2);
      expect(txModel.deleteOne).toHaveBeenCalledTimes(1);
      // The retry asks the ledger for the same movement again, and it lands.
      expect(ledger.apply).toHaveBeenCalledTimes(2);
      expect(ledger.apply).toHaveBeenLastCalledWith(-100, 'expense', expect.any(String), expect.any(String));
    });
  });

  // The watermark never advances, so every poll re-fetches every mail since
  // the start date. Dedupe used to happen only at create() (unique index),
  // AFTER FX, Mistral categorisation and three queries had already run for
  // each historical mail — a paid model call per unknown merchant, forever.
  describe('per-run work', () => {
    it('skips a mail whose id is already ingested before any parsing or categorising', async () => {
      txModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'msg-1' }]),
        }),
      });
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'msg-1' })]);
      parserParseMock.mockReturnValue(makeParsed());

      const result = await service.run();

      expect(result).toEqual(counts({ alreadyBooked: 1 }));
      // Exact, deliberately: a soft-deleted email row must STILL block
      // re-ingestion, so this query must never filter on deletedAt.
      expect(txModel.find).toHaveBeenCalledWith({ sourceMessageId: { $in: ['msg-1'] } });
      expect(parserParseMock).not.toHaveBeenCalled();
      expect(categorizer.categorize).not.toHaveBeenCalled();
      expect(fx.usdToDop).not.toHaveBeenCalled();
      expect(txModel.create).not.toHaveBeenCalled();
    });

    // A mail can be listed as unreadable, then get booked by a later run whose
    // own clearUnreadable call happened to fail (best-effort write). The next
    // run must still close it out, even though the mail is now skipped here as
    // already-ingested rather than reaching the create()-time clear.
    it('clears an already-ingested mail from the unreadable list', async () => {
      txModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'm1' }]),
        }),
      });
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
      parserParseMock.mockReturnValue(makeParsed());

      await service.run();

      expect(status.clearUnreadableMany).toHaveBeenCalledWith(['m1']);
    });

    // A mixed run: m1 is already booked (known), m2 is not. Without the
    // `known` filter, clearUnreadableMany would be called with every mail id
    // fetched this run — including m2, which never touched the unreadable
    // list — so every poll would delete dismissed and unreadable records
    // wholesale instead of only the ones that actually booked or were
    // recognised.
    it('clears only the known mails from the unreadable list, not every mail fetched this run', async () => {
      txModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'm1' }]),
        }),
      });
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' }), makeMail({ messageId: 'm2' })]);
      parserParseMock.mockReturnValue(makeParsed());

      await service.run();

      expect(status.clearUnreadableMany).toHaveBeenCalledWith(['m1']);
    });

    // Forgetting is only safe when the watermark comes from a configured start
    // date. With the rolling 24-hour fallback, forgetting would drop mail
    // that's still genuinely unread a day after it arrived.
    describe('forgetting unreadable mail before the window', () => {
      let savedStartAt: string | undefined;
      beforeEach(() => { savedStartAt = process.env.INGEST_START_AT; });
      afterEach(() => {
        if (savedStartAt === undefined) delete process.env.INGEST_START_AT;
        else process.env.INGEST_START_AT = savedStartAt;
      });

      it('forgets unreadable mail from before the configured start, when one is configured', async () => {
        process.env.INGEST_START_AT = '2026-09-24T14:58:59Z';
        await service.run();
        expect(status.forgetUnreadableBefore).toHaveBeenCalledWith(new Date('2026-09-24T14:58:59Z'));
      });

      it('does not forget unreadable mail with the rolling 24-hour fallback (no configured start date)', async () => {
        delete process.env.INGEST_START_AT;
        await service.run();
        expect(status.forgetUnreadableBefore).not.toHaveBeenCalled();
      });
    });

    it('reads the account lists once per run, not once per mail', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' }), makeMail({ messageId: 'm2' })]);
      parserParseMock.mockReturnValue(makeParsed());

      await service.run();

      expect(settings.accounts).toHaveBeenCalledTimes(1);
    });

    it('loads custom categories and recurring rules once per run, not once per mail', async () => {
      mail.fetchSince.mockResolvedValue([
        makeMail({ messageId: 'm1' }),
        makeMail({ messageId: 'm2' }),
        makeMail({ messageId: 'm3' }),
      ]);
      parserParseMock.mockReturnValue(makeParsed());

      const result = await service.run();

      expect(result).toEqual(counts({ created: 3 }));
      expect(categories.list).toHaveBeenCalledTimes(1);
      expect(recurringModel.find).toHaveBeenCalledTimes(1);
      expect(memory.all).toHaveBeenCalledTimes(1);
    });

    it('files a remembered merchant straight away: no review, no AI', async () => {
      memory.all.mockResolvedValue(new Map([['prime video', 'food']]));
      mail.fetchSince.mockResolvedValue([makeMail()]);
      parserParseMock.mockReturnValue(makeParsed({ counterparty: 'PRIME VIDEO*2K3JD' }));

      await service.run();

      const created = txModel.create.mock.calls[0][0];
      expect(created.category).toBe('food');
      expect(created.categoryNeedsReview).toBe(false);
      expect(categorizer.categorize).not.toHaveBeenCalled();
    });

    it('asks the categorizer when the remembered category no longer exists', async () => {
      memory.all.mockResolvedValue(new Map([['prime video', 'gone']]));
      mail.fetchSince.mockResolvedValue([makeMail()]);
      parserParseMock.mockReturnValue(makeParsed({ counterparty: 'PRIME VIDEO*2K3JD' }));

      await service.run();

      expect(categorizer.categorize).toHaveBeenCalled();
    });

    it('never applies the memory to income or ATM withdrawals', async () => {
      memory.all.mockResolvedValue(new Map([['cajero automatico', 'food'], ['some wire', 'food']]));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' }), makeMail({ messageId: 'm2' })]);
      parserParseMock
        .mockReturnValueOnce(makeParsed({ isWithdrawal: true, counterparty: 'Cajero Automatico' }))
        .mockReturnValueOnce(makeParsed({ direction: 'income', counterparty: 'Some Wire' }));

      await service.run();

      expect(txModel.create.mock.calls[0][0].category).toBe('cash');
      expect(txModel.create.mock.calls[1][0].category).toBe('other');
    });

    // The category allow-list has one source of truth: CategoriesService. A
    // custom category classified by the (mocked) categorizer must be
    // persisted under its own canonical spelling, not silently dropped.
    it('persists a mail categorized into a custom category by its canonical name', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
      parserParseMock.mockReturnValue(makeParsed());
      categorizer.categorize.mockResolvedValue({ category: 'Gym', needsReview: true });

      const result = await service.run();

      expect(result).toEqual(counts({ created: 1 }));
      const created = txModel.create.mock.calls[0][0];
      expect(created.category).toBe('Gym');
      expect(categorizer.categorize).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['Gym']));
    });

    it('does not start a second run while one is still in flight', async () => {
      let release!: () => void;
      mail.fetchSince.mockReturnValue(
        new Promise<FetchedMail[]>((resolve) => {
          release = () => resolve([]);
        }),
      );

      const first = service.poll();
      const second = service.poll();
      // watermark() now awaits status.windowStart() before calling
      // fetchSince; a macrotask flush is a more robust way to let that
      // pending microtask chain resolve than counting exact ticks.
      await new Promise((r) => setImmediate(r));
      expect(mail.fetchSince).toHaveBeenCalledTimes(1);

      release();
      await Promise.all([first, second]);
      expect(mail.fetchSince).toHaveBeenCalledTimes(1);

      // Once the first run has finished, the next poll runs normally.
      mail.fetchSince.mockResolvedValue([]);
      await service.poll();
      expect(mail.fetchSince).toHaveBeenCalledTimes(2);
    });
  });

  describe('reading window and verification', () => {
    const NOW = new Date('2026-09-26T12:00:00Z');
    const DAY = 24 * 3600_000;
    const saved = { verify: process.env.MAIL_VERIFY, start: process.env.INGEST_START_AT };
    afterEach(() => {
      if (saved.verify === undefined) delete process.env.MAIL_VERIFY; else process.env.MAIL_VERIFY = saved.verify;
      if (saved.start === undefined) delete process.env.INGEST_START_AT; else process.env.INGEST_START_AT = saved.start;
    });

    // GMAIL_USER / GMAIL_APP_PASSWORD unset is the documented way to pause
    // ingestion (MailClient.fetchSince then returns null, not []). A run that
    // never opened the mailbox must not forget unreadable mail or move the
    // resume point — either would narrow the window while paused, so mail
    // from before ingestion resumed would never be read once it comes back.
    it('does nothing and returns zero counts when the mailbox is not configured', async () => {
      mail.fetchSince.mockResolvedValue(null);
      const result = await service.run(NOW);
      expect(result).toEqual(counts());
      expect(status.recordResumePoint).not.toHaveBeenCalled();
      expect(status.forgetUnreadableBefore).not.toHaveBeenCalled();
    });

    it('reads from the window start the status gives', async () => {
      const from = new Date('2026-09-24T09:00:00Z');
      status.windowStart.mockResolvedValue(from);
      await service.run(NOW);
      expect(mail.fetchSince).toHaveBeenCalledWith(from, expect.any(Array), null);
    });

    it('reads the last 24 hours when there is no window start yet', async () => {
      await service.run(NOW);
      expect(mail.fetchSince).toHaveBeenCalledWith(new Date(NOW.getTime() - DAY), expect.any(Array), null);
    });

    it('stores the next start two days before this run began', async () => {
      await service.run(NOW);
      expect(status.recordResumePoint).toHaveBeenCalledWith(new Date(NOW.getTime() - 2 * DAY), null);
    });

    it('does not slide the point back on an empty run', async () => {
      await service.run(NOW);
      await service.run(new Date(NOW.getTime() + 10 * 60_000));
      expect(status.recordResumePoint).toHaveBeenLastCalledWith(new Date(NOW.getTime() + 10 * 60_000 - 2 * DAY), null);
    });

    // The pin uses arrivedAt (Gmail's own arrival time), not receivedAt (the
    // sender's Date header, forgeable and sometimes days late) — a stale
    // receivedAt here must not affect where the point lands.
    it('pulls the point back to a mail whose booking failed', async () => {
      mail.fetchSince.mockResolvedValue([
        makeMail({ arrivedAt: new Date(NOW.getTime() - 5 * DAY), receivedAt: new Date(NOW.getTime() - 50 * DAY) }),
      ]);
      parserParseMock.mockReturnValue(makeParsed());
      txModel.create.mockRejectedValue(new Error('write refused'));
      const result = await service.run(NOW);
      expect(result.bookingFailed).toBe(1);
      expect(status.recordResumePoint).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * DAY), null);
    });

    it('pulls the point back to an unreadable mail still waiting', async () => {
      status.oldestPendingUnreadable.mockResolvedValue(new Date(NOW.getTime() - 10 * DAY));
      await service.run(NOW);
      expect(status.recordResumePoint).toHaveBeenCalledWith(new Date(NOW.getTime() - 12 * DAY), null);
    });

    it('leaves the point where it was when the waiting list cannot be read', async () => {
      status.oldestPendingUnreadable.mockRejectedValue(new Error('db down'));
      await expect(service.run(NOW)).resolves.toEqual(counts());
      expect(status.recordResumePoint).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('does not move the point when the run fails as a whole', async () => {
      mail.fetchSince.mockRejectedValue(new Error('Cannot open mailbox "Banks"'));
      await expect(service.runGuarded()).rejects.toThrow();
      expect(status.recordResumePoint).not.toHaveBeenCalled();
    });

    it('forgets unreadable mail only before the configured start, never before the moving window', async () => {
      process.env.INGEST_START_AT = '2026-09-01T00:00:00Z';
      status.windowStart.mockResolvedValue(new Date('2026-09-24T00:00:00Z'));
      await service.run(NOW);
      expect(status.forgetUnreadableBefore).toHaveBeenCalledWith(new Date('2026-09-01T00:00:00Z'));
    });

    // The configured start is the business rule "historical mail is never
    // booked", judged on the mail's own claimed date — passed to MailClient
    // separately from the moving window (`since`), which is judged on arrival.
    it('passes the configured start to MailClient as notBefore, separate from the moving window', async () => {
      process.env.INGEST_START_AT = '2026-09-01T00:00:00Z';
      const from = new Date('2026-09-24T00:00:00Z');
      status.windowStart.mockResolvedValue(from);
      await service.run(NOW);
      expect(mail.fetchSince).toHaveBeenCalledWith(from, expect.any(Array), new Date('2026-09-01T00:00:00Z'));
    });

    it('passes null as notBefore when no start is configured', async () => {
      delete process.env.INGEST_START_AT;
      await service.run(NOW);
      expect(mail.fetchSince).toHaveBeenCalledWith(expect.any(Date), expect.any(Array), null);
    });

    // The stored point is tagged with the start it was computed under
    // (IngestionStatusService.windowStart then re-reads from a lowered start
    // instead of treating a stale point as still pinning the window).
    it('tags the stored resume point with the currently configured start', async () => {
      process.env.INGEST_START_AT = '2026-09-01T00:00:00Z';
      await service.run(NOW);
      expect(status.recordResumePoint).toHaveBeenCalledWith(expect.any(Date), new Date('2026-09-01T00:00:00Z'));
    });

    it('in report mode books an unverified mail, counts it and names its sender', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      parserParseMock.mockReturnValue(makeParsed());
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ created: 1, unverified: 1 }));
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('popular@bank.com'));
    });

    it('in enforce mode lists a new unverified mail as unreadable, with the reason, without parsing it', async () => {
      process.env.MAIL_VERIFY = 'enforce';
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ unreadable: 1, unverified: 1 }));
      expect(parserParseMock).not.toHaveBeenCalled();
      expect(status.recordUnreadable).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-1', reason: "Couldn't verify it came from the bank" }));
    });

    it('in enforce mode still counts an already booked unverified mail as booked', async () => {
      process.env.MAIL_VERIFY = 'enforce';
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      txModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'msg-1' }]) }) });
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ alreadyBooked: 1, unverified: 1 }));
      expect(status.recordUnreadable).not.toHaveBeenCalled();
    });

    // MailClient marks a mail unopened when a bug of ours (not the sender's
    // fault) kept it from being parsed at all; it must be listed, not passed
    // to a parser that has nothing usable to read.
    it('lists an unopened mail as unreadable, with its own reason, and never parses it', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ unopened: true, verified: false, body: '' })]);
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ unreadable: 1, unverified: 1 }));
      expect(parserParseMock).not.toHaveBeenCalled();
      expect(status.recordUnreadable).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-1', reason: "Couldn't open the mail" }));
    });

    // M1: every unverified mail is still counted, but a mail already booked or
    // dismissed doesn't deserve a fresh warning every single poll — that
    // would bury the genuinely new unverified mail under routine noise.
    it('counts an already-booked unverified mail but does not warn about it', async () => {
      txModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'msg-1' }]) }) });
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ alreadyBooked: 1, unverified: 1 }));
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    // M4: MAIL_VERIFY is operator input in the Secret; whitespace or case
    // must not silently disable the enforcement the operator asked for.
    it('normalises MAIL_VERIFY: " Enforce " still enforces', async () => {
      process.env.MAIL_VERIFY = ' Enforce ';
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ unreadable: 1, unverified: 1 }));
      expect(parserParseMock).not.toHaveBeenCalled();
    });

    // An unrecognised value must not fail silently either way: it's treated
    // as "report" (the safer default — nothing is ever refused by accident),
    // but named in a warning so a typo like this is noticed.
    it('warns and falls back to report mode for an unrecognised MAIL_VERIFY value', async () => {
      process.env.MAIL_VERIFY = 'enfroce';
      mail.fetchSince.mockResolvedValue([makeMail({ verified: false })]);
      parserParseMock.mockReturnValue(makeParsed());
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ created: 1, unverified: 1 }));
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('enfroce'));
    });

    // M5: only a booking failure or a still-waiting unreadable mail may pull
    // the point back — an old mail that simply booked fine must not.
    it('does not pull the point back for an old mail that booked successfully', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ arrivedAt: new Date(NOW.getTime() - 5 * DAY) })]);
      parserParseMock.mockReturnValue(makeParsed());
      await service.run(NOW);
      expect(status.recordResumePoint).toHaveBeenCalledWith(new Date(NOW.getTime() - 2 * DAY), null);
    });

    it('pulls the point back to the earlier of two booking failures', async () => {
      mail.fetchSince.mockResolvedValue([
        makeMail({ messageId: 'm1', arrivedAt: new Date(NOW.getTime() - 3 * DAY) }),
        makeMail({ messageId: 'm2', arrivedAt: new Date(NOW.getTime() - 6 * DAY) }),
      ]);
      parserParseMock.mockReturnValue(makeParsed());
      txModel.create.mockRejectedValue(new Error('write refused'));
      const result = await service.run(NOW);
      expect(result.bookingFailed).toBe(2);
      expect(status.recordResumePoint).toHaveBeenCalledWith(new Date(NOW.getTime() - 8 * DAY), null);
    });

    it('in enforce mode counts a dismissed unverified mail as not-a-transaction, not unreadable', async () => {
      process.env.MAIL_VERIFY = 'enforce';
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1', verified: false })]);
      status.dismissedAmong.mockResolvedValue(new Set(['m1']));
      const result = await service.run(NOW);
      expect(result).toEqual(counts({ notTransactions: 1, unverified: 1 }));
      expect(status.recordUnreadable).not.toHaveBeenCalled();
    });

    // Something that throws all the way out of run() (not one of the
    // per-mail paths persist() itself already catches) must fail the whole
    // run — updateResumePoint runs only after the loop finishes, so it must
    // never be reached.
    it('leaves the point unmoved when something throws out of the loop entirely', async () => {
      const rule = { _id: 'rule-1', userId: 999, amount: 100, dayOfMonth: 1, active: true, transactionType: TransactionType.EXPENSE };
      recurringModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([rule]) });
      txModel.findOne.mockRejectedValue(new Error('read exploded'));
      mail.fetchSince.mockResolvedValue([makeMail()]);
      parserParseMock.mockReturnValue(
        makeParsed({ direction: 'expense', amount: 100, currency: 'DOP', occurredAt: new Date(2026, 0, 1) }),
      );

      await expect(service.run(NOW)).rejects.toThrow('read exploded');
      expect(status.recordResumePoint).not.toHaveBeenCalled();
    });
  });

  // A Popular "transf recibida" email names no sender. The money may be a
  // third party paying the user, or the user's own transfer from another bank
  // whose sending leg was correctly suppressed as internal. Booking it as
  // income would add phantom income equal to every self-funding transfer, so
  // the received leg is recorded as unresolved and reconciled against a sent
  // leg in either arrival order. Nothing in these paths moves the balance.
  describe('received-transfer leg matching', () => {
    const DAY = 24 * 3600_000;
    const at = new Date(2026, 2, 10, 9, 0);

    /**
     * Stand-in for the leg query: filters `rows` the way Mongo would on the
     * fields the service is expected to constrain. Recurring lookups (which
     * carry a recurringId, not a transferKind) find nothing.
     */
    function legStore(rows: any[]) {
      return (q: any) => {
        if (!q.transferKind) return Promise.resolve(null);
        const hit = rows.find(
          (r) =>
            r.source === q.source &&
            r.transferKind === q.transferKind &&
            r.amount === q.amount &&
            r.timestamp >= q.timestamp.$gte &&
            r.timestamp <= q.timestamp.$lte &&
            (q.matchedLegId?.$exists === false ? r.matchedLegId === undefined : true),
        );
        return Promise.resolve(hit ?? null);
      };
    }

    const received = () =>
      makeParsed({
        direction: 'income',
        amount: 2000,
        currency: 'DOP',
        occurredAt: at,
        counterparty: 'Transferencia recibida',
        transferKind: 'unresolved',
        isReceivedTransfer: true,
      });
    const sent = (occurredAt: Date = at) =>
      makeParsed({
        direction: 'expense',
        amount: 2000,
        currency: 'DOP',
        occurredAt,
        counterparty: 'JUAN ANTONIO RIVERA MART',
        transferKind: 'internal',
      });

    it('records a received leg with no sent leg as unresolved, needing review, without moving the balance', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());

      const result = await service.run();

      expect(result).toEqual(counts({ created: 1 }));
      const created = txModel.create.mock.calls[0][0];
      expect(created.transferKind).toBe('unresolved');
      expect(created.transactionType).toBe(TransactionType.INCOME);
      expect(created.amount).toBe(2000);
      expect(created.categoryNeedsReview).toBe(true);
      expect(created.matchedLegId).toBeUndefined();
      expect(txModel.updateOne).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('received first, then sent: both legs end internal and point at each other', async () => {
      // Run 1 — the received leg arrives alone.
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'rx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());
      await service.run();
      const rxRow = { _id: 'rx-id', ...txModel.create.mock.calls[0][0] };
      expect(rxRow.transferKind).toBe('unresolved');

      // Run 2 — the sent leg arrives and must find the waiting received leg.
      txModel.findOne.mockImplementation(legStore([rxRow]));
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'tx-mail' })]);
      parserParseMock.mockReturnValue(sent());
      const result = await service.run();

      expect(result).toEqual(counts({ created: 1 }));
      const sentCreated = txModel.create.mock.calls[1][0];
      expect(sentCreated.transferKind).toBe('internal');
      expect(sentCreated.matchedLegId).toBe('rx-id');
      // Only an unresolved leg may be flipped to internal here: if the user had
      // resolved this received leg to external in between, its balance already
      // moved, and this write must not silently relabel it as internal.
      expect(txModel.updateOne).toHaveBeenCalledWith(
        { _id: 'rx-id', transferKind: 'unresolved', ...NOT_DELETED },
        { $set: { transferKind: 'internal', matchedLegId: 'tx-id' } },
      );
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    // Between findCounterLeg's read and the link write, the received leg may
    // have been resolved by a concurrent request (e.g. resolved to external
    // by the user). The guarded update then matches nothing: this mail is not
    // actually paired with that row, so it must not point matchedLegId at a
    // row that is no longer internal.
    it('received first, then sent: the counter leg is no longer unresolved when the link write runs', async () => {
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'rx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());
      await service.run();
      const rxRow = { _id: 'rx-id', ...txModel.create.mock.calls[0][0] };

      txModel.findOne.mockImplementation(legStore([rxRow]));
      txModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'tx-mail' })]);
      parserParseMock.mockReturnValue(sent());
      const result = await service.run();

      expect(result).toEqual(counts({ created: 1 }));
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Counter leg rx-id no longer unresolved; recording tx-mail unlinked'),
      );
      // The created row must not end up pointing at a leg it never actually
      // claimed: the optimistic matchedLegId set at create() is corrected by
      // an explicit follow-up unset once the claim is known to have failed.
      expect(txModel.updateOne).toHaveBeenCalledWith(
        { _id: 'tx-id' },
        { $unset: { matchedLegId: 1 } },
      );
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('sent first, then received: the received leg is created internal and linked to the sent leg', async () => {
      // Run 1 — the sent leg arrives alone; nothing to link yet.
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'tx-mail' })]);
      parserParseMock.mockReturnValue(sent());
      await service.run();
      const sentRow = { _id: 'tx-id', ...txModel.create.mock.calls[0][0] };
      expect(sentRow.transferKind).toBe('internal');
      expect(sentRow.matchedLegId).toBeUndefined();
      expect(txModel.updateOne).not.toHaveBeenCalled();

      // Run 2 — the received leg arrives and must find the sent leg.
      txModel.findOne.mockImplementation(legStore([sentRow]));
      txModel.create.mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'rx-id', ...doc }));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());
      const result = await service.run();

      expect(result).toEqual(counts({ created: 1 }));
      const rxCreated = txModel.create.mock.calls[1][0];
      expect(rxCreated.transferKind).toBe('internal');
      expect(rxCreated.transactionType).toBe(TransactionType.INCOME);
      expect(rxCreated.matchedLegId).toBe('tx-id');
      expect(txModel.updateOne).toHaveBeenCalledWith(
        { _id: 'tx-id' },
        { $set: { transferKind: 'internal', matchedLegId: 'rx-id' } },
      );
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    // Only a sent leg that was itself classified internal (destination is one
    // of the user's own cash accounts) can be the other half of a received
    // transfer. A genuine payment to a third party of the same amount on the
    // same day is a coincidence, not a match.
    it('does not match a received leg against an external expense of the same amount', async () => {
      const externalRow = {
        _id: 'ext-id',
        source: 'email',
        transferKind: 'external',
        amount: -2000,
        timestamp: at,
      };
      txModel.findOne.mockImplementation(legStore([externalRow]));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());

      await service.run();

      const created = txModel.create.mock.calls[0][0];
      expect(created.transferKind).toBe('unresolved');
      expect(created.matchedLegId).toBeUndefined();
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });

    // A leg the user soft-deleted must not be paired with a new arrival.
    it('looks for the counter leg among live rows only', async () => {
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());

      await service.run();

      expect(txModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ transferKind: 'internal', ...NOT_DELETED }),
      );
    });

    it('does not match legs more than a day apart', async () => {
      const staleSent = {
        _id: 'old-id',
        source: 'email',
        transferKind: 'internal',
        amount: -2000,
        timestamp: new Date(at.getTime() - 2 * DAY),
      };
      txModel.findOne.mockImplementation(legStore([staleSent]));
      mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'rx-mail' })]);
      parserParseMock.mockReturnValue(received());

      await service.run();

      const created = txModel.create.mock.calls[0][0];
      expect(created.transferKind).toBe('unresolved');
      expect(created.matchedLegId).toBeUndefined();
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
