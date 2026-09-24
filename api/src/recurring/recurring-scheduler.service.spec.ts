import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';

// @nestjs/schedule ships ESM-only and Jest here does not transform it (see
// ingestion.service.spec.ts). This stub also records every cron expression it
// is given, so the schedule itself can be asserted.
jest.mock('@nestjs/schedule', () => {
  const cronExpressions: string[] = [];
  return {
    __cronExpressions: cronExpressions,
    Cron: (expression: string) => {
      cronExpressions.push(expression);
      return () => undefined;
    },
  };
});

import { RecurringSchedulerService } from './recurring-scheduler.service';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { RecurringModule } from './recurring.module';
import { LedgerModule } from '../shared/ledger/ledger.module';

/** Rules are "created" 2026-01-01 unless a test says otherwise: the ObjectId carries the time. */
const CREATED_HEX = Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(16);
let idSeq = 0;
const ruleId = () => new Types.ObjectId(CREATED_HEX + String(++idSeq).padStart(16, '0'));

function makeRule(overrides: Record<string, unknown> = {}): any {
  return {
    _id: ruleId(),
    // What Mongoose puts in a legacy rule stored without createdAt: "now". The
    // sweep must ignore it and read the creation time from the ObjectId, or
    // every legacy rule's due occurrences look older than the rule and nothing
    // is ever booked.
    createdAt: NOW,
    userId: 1,
    userName: 'web',
    transactionName: 'loan',
    transactionType: TransactionType.EXPENSE,
    amount: 5000,
    category: 'housing',
    dayOfMonth: 20,
    active: true,
    ...overrides,
  };
}

const NOW = new Date('2026-09-25T15:00:00Z');
const SEP = { period: '2026-09', dueAt: new Date('2026-09-20T12:00:00Z') };

describe('RecurringSchedulerService', () => {
  let service: RecurringSchedulerService;
  let recurringModel: { find: jest.Mock; updateOne: jest.Mock };
  let txModel: { findOne: jest.Mock; create: jest.Mock; deleteOne: jest.Mock };
  let ledger: { apply: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    recurringModel = { find: jest.fn().mockResolvedValue([]), updateOne: jest.fn().mockResolvedValue({}) };
    txModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'tx1' }),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    ledger = { apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }) };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringSchedulerService,
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();
    service = module.get(RecurringSchedulerService);
  });

  afterEach(() => jest.restoreAllMocks());

  /** The exact arguments of a forward-only "mark handled" update. */
  const markedHandled = (rule: any, period: string, at: Date = NOW) => [
    { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
    { $set: { lastPeriod: period, lastExecutedAt: at } },
  ];

  describe('bookOccurrence', () => {
    it('books an expense once: linked row, negative amount, one ledger movement, marker forward', async () => {
      const rule = makeRule();
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('booked');
      expect(txModel.create).toHaveBeenCalledWith({
        userId: 1,
        userName: 'web',
        transactionName: 'loan',
        transactionType: TransactionType.EXPENSE,
        amount: -5000,
        timestamp: SEP.dueAt,
        category: 'housing',
        source: 'recurring',
        recurringId: String(rule._id),
        recurringPeriod: '2026-09',
      });
      expect(ledger.apply).toHaveBeenCalledTimes(1);
      expect(ledger.apply).toHaveBeenCalledWith(-5000, 'recurring', 'loan', 'tx1');
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('books income as a positive amount', async () => {
      const rule = makeRule({ transactionType: TransactionType.INCOME, amount: 45000, transactionName: 'salary' });
      await service.bookOccurrence(rule, SEP, NOW);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 45000 }));
      expect(ledger.apply).toHaveBeenCalledWith(45000, 'recurring', 'salary', 'tx1');
    });

    it('signs by type, not by the stored sign: a legacy expense stored negative stays an expense', async () => {
      await service.bookOccurrence(makeRule({ amount: -5000 }), SEP, NOW);
      expect(ledger.apply).toHaveBeenCalledWith(-5000, 'recurring', 'loan', 'tx1');
    });

    it('fails closed on an unknown transactionType: nothing written, nothing moved', async () => {
      // The English word is exactly the mistake to guard against: the enum's values are 'Доход'/'Расход'.
      const rule = makeRule({ transactionType: 'income' });
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('failed');
      expect(txModel.findOne).not.toHaveBeenCalled();
      expect(txModel.create).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });

    it('treats a live linked row as already satisfied: no second row, no money', async () => {
      const rule = makeRule();
      txModel.findOne.mockResolvedValue({ _id: 'emailRow' });
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('satisfied');
      expect(txModel.findOne).toHaveBeenCalledWith({
        userId: 1,
        recurringId: String(rule._id),
        recurringPeriod: '2026-09',
        deletedAt: null,
      });
      expect(txModel.create).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('treats a duplicate key on insert as satisfied by another writer: no money', async () => {
      const rule = makeRule();
      txModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('satisfied');
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('propagates any other insert error without moving money or the marker', async () => {
      txModel.create.mockRejectedValue(new Error('connection reset'));
      await expect(service.bookOccurrence(makeRule(), SEP, NOW)).rejects.toThrow('connection reset');
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });

    it('rolls the row back when the ledger fails and leaves the marker for the next hour', async () => {
      ledger.apply.mockRejectedValue(new Error('balance write failed'));
      await expect(service.bookOccurrence(makeRule(), SEP, NOW)).resolves.toBe('failed');
      expect(txModel.deleteOne).toHaveBeenCalledWith({ _id: 'tx1' });
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('wiring', () => {
    it('runs hourly at minute 5', () => {
      const { __cronExpressions } = jest.requireMock('@nestjs/schedule');
      expect(__cronExpressions).toContain('5 * * * *');
    });

    it('is a provider of RecurringModule, which imports the ledger', () => {
      expect(Reflect.getMetadata('providers', RecurringModule)).toContain(RecurringSchedulerService);
      expect(Reflect.getMetadata('imports', RecurringModule)).toContain(LedgerModule);
    });
  });

  describe('sweep', () => {
    const summary = (booked: number, satisfied: number, skipped: number, failed: number) =>
      `Recurring sweep: booked ${booked}, satisfied ${satisfied}, skipped ${skipped} (older than 31 days), failed ${failed}`;

    it('reads only the owner’s active rules', async () => {
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledWith({ userId: 1, active: true });
    });

    it('books the September occurrence the bot missed, dated on its day, and reports it', async () => {
      recurringModel.find.mockResolvedValue([makeRule({ dayOfMonth: 20, lastExecutedAt: new Date('2026-08-20T12:00:05Z') })]);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: new Date('2026-09-20T12:00:00Z'),
          recurringPeriod: '2026-09',
          amount: -5000,
          source: 'recurring',
        }),
      );
      expect(ledger.apply).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 0, 0));
    });

    it('stops a rule at its first failed occurrence so the marker never passes it', async () => {
      // Two due occurrences (Aug 26 and Sep 26); the older one's ledger write fails.
      recurringModel.find.mockResolvedValue([makeRule({ dayOfMonth: 26, lastPeriod: '2026-07' })]);
      ledger.apply.mockRejectedValueOnce(new Error('balance write failed'));
      await service.sweep(new Date('2026-09-26T12:00:00Z'));
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ recurringPeriod: '2026-08' }));
      expect(txModel.deleteOne).toHaveBeenCalledWith({ _id: 'tx1' });
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(summary(0, 0, 0, 1));
    });

    it('keeps going when one rule throws', async () => {
      const rent = makeRule({ transactionName: 'rent', lastPeriod: '2026-08' });
      const loan = makeRule({ transactionName: 'loan', lastPeriod: '2026-08' });
      recurringModel.find.mockResolvedValue([rent, loan]);
      txModel.findOne.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(null);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ transactionName: 'loan' }));
      expect(errorSpy).toHaveBeenCalledWith(`Recurring ${String(rent._id)} failed`, expect.any(String));
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 0, 1));
    });

    it('skips occurrences older than 31 days: marks the newest skipped month, books the rest, warns once', async () => {
      const rule = makeRule({ dayOfMonth: 10, lastPeriod: '2026-06' });
      recurringModel.find.mockResolvedValue([rule]);
      await service.sweep(NOW);
      expect(recurringModel.updateOne).toHaveBeenNthCalledWith(1, ...markedHandled(rule, '2026-08'));
      expect(recurringModel.updateOne).toHaveBeenNthCalledWith(2, ...markedHandled(rule, '2026-09'));
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ recurringPeriod: '2026-09' }));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2026-07, 2026-08'));
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 2, 0));
    });

    it('does not start a second sweep while one is in flight', async () => {
      let release!: (rules: unknown[]) => void;
      recurringModel.find.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      const first = service.sweep(NOW);
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledTimes(1);
      release([]);
      await first;
    });

    it('logs a failed rule query instead of throwing, and releases the guard', async () => {
      recurringModel.find.mockRejectedValueOnce(new Error('mongo down'));
      await expect(service.sweep(NOW)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('Recurring sweep failed', expect.any(String));
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledTimes(2);
    });
  });
});
