import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger, NotFoundException } from '@nestjs/common';
import { IngestionStatusService } from './ingestion-status.service';
import { IngestionStatus } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail } from '../shared/schemas/unreadable-mail.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = {
    sort: jest.fn(() => q),
    limit: jest.fn(() => q),
    select: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return q;
}

const AT = new Date('2026-09-25T02:40:00Z');
const MAIL_ID = '64b0000000000000000000c1';

describe('IngestionStatusService', () => {
  let service: IngestionStatusService;
  let statusModel: { updateOne: jest.Mock; findOne: jest.Mock };
  let unreadableModel: { updateOne: jest.Mock; deleteOne: jest.Mock; deleteMany: jest.Mock; find: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock; aggregate: jest.Mock };
  let txModel: { find: jest.Mock };
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    delete process.env.INGEST_START_AT;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    statusModel = { updateOne: jest.fn().mockResolvedValue({}), findOne: jest.fn(() => query(null)) };
    unreadableModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: MAIL_ID }),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    txModel = { find: jest.fn(() => query([])) };
    const mod = await Test.createTestingModule({
      providers: [
        IngestionStatusService,
        { provide: getModelToken(IngestionStatus.name), useValue: statusModel },
        { provide: getModelToken(UnreadableMail.name), useValue: unreadableModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
      ],
    }).compile();
    service = mod.get(IngestionStatusService);
  });

  afterEach(() => errorSpy.mockRestore());

  it("records a finished run's counts and clears the last error", async () => {
    await service.recordRun({ created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0, unverified: 0 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      {
        $set: { lastRunAt: AT, created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0, unverified: 0, lastError: null },
        $unset: { skipped: '', failed: '' },
      },
      { upsert: true, strict: false },
    );
  });

  it('forgets unreadable mails from before the reading window, keeping dismissals', async () => {
    const since = new Date('2026-09-01T04:00:00Z');
    await service.forgetUnreadableBefore(since);
    expect(unreadableModel.deleteMany).toHaveBeenCalledWith({ userId: 1, receivedAt: { $lt: since }, dismissed: { $ne: true } });
  });

  it('removes the old skipped/failed fields when it records a run', async () => {
    await service.recordRun({ created: 1, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      expect.objectContaining({ $unset: { skipped: '', failed: '' } }),
      expect.objectContaining({ upsert: true, strict: false }),
    );
  });

  it('records a failed run with its message, cut to 500 characters', async () => {
    await service.recordFailure(new Error('x'.repeat(600)), AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      { $set: { lastError: 'x'.repeat(500), lastErrorAt: AT } },
      { upsert: true },
    );
  });

  it('never throws from a write: it logs instead', async () => {
    statusModel.updateOne.mockRejectedValue(new Error('db down'));
    unreadableModel.updateOne.mockRejectedValue(new Error('db down'));
    unreadableModel.deleteOne.mockRejectedValue(new Error('db down'));
    await expect(
      service.recordRun({ created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 }),
    ).resolves.toBeUndefined();
    await expect(service.recordFailure(new Error('x'))).resolves.toBeUndefined();
    await expect(service.recordUnreadable({ messageId: 'm1', sender: 's', subject: 'x', receivedAt: AT })).resolves.toBeUndefined();
    await expect(service.clearUnreadable('m1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(4);
  });

  it('upserts an unreadable mail, counting each attempt', async () => {
    const receivedAt = new Date('2026-09-25T01:53:30Z');
    await service.recordUnreadable({ messageId: 'm1', sender: 'alerts@bank.example', subject: 'Alert', receivedAt }, AT);
    expect(unreadableModel.updateOne).toHaveBeenCalledWith(
      { userId: 1, messageId: 'm1' },
      {
        $set: { sender: 'alerts@bank.example', subject: 'Alert', receivedAt, lastSeenAt: AT },
        $unset: { reason: '' },
        $setOnInsert: { firstSeenAt: AT, dismissed: false },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );
  });

  it('stores arrivedAt on an unreadable mail when given (Gmail arrival time, for the resume-point pin)', async () => {
    const receivedAt = new Date('2026-09-25T01:53:30Z');
    const arrivedAt = new Date('2026-09-25T02:00:00Z');
    await service.recordUnreadable({ messageId: 'm1', sender: 'alerts@bank.example', subject: 'Alert', receivedAt, arrivedAt }, AT);
    const [, update] = unreadableModel.updateOne.mock.calls[0];
    expect(update.$set.arrivedAt).toEqual(arrivedAt);
  });

  it('records the unverified count with the run', async () => {
    await service.recordRun({ created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 2 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      expect.objectContaining({ $set: expect.objectContaining({ unverified: 2 }) }),
      expect.anything(),
    );
  });

  describe('unreadable reason', () => {
    const receivedAt = new Date('2026-09-25T01:53:30Z');

    it('stores the reason when one is given', async () => {
      await service.recordUnreadable({ messageId: 'm1', sender: 's@bank.example', subject: 'x', receivedAt, reason: "Couldn't verify it came from the bank" }, AT);
      const [, update] = unreadableModel.updateOne.mock.calls[0];
      expect(update.$set.reason).toBe("Couldn't verify it came from the bank");
      expect(update.$unset).toBeUndefined();
    });

    it('clears an old reason when the mail is unreadable for no special reason', async () => {
      await service.recordUnreadable({ messageId: 'm1', sender: 's@bank.example', subject: 'x', receivedAt }, AT);
      const [, update] = unreadableModel.updateOne.mock.calls[0];
      expect(update.$set).not.toHaveProperty('reason');
      expect(update.$unset).toEqual({ reason: '' });
    });
  });

  describe('windowStart', () => {
    const START = '2026-09-01T12:00:00Z';
    // recordResumePoint always stores configuredStart?.toISOString() — always
    // millisecond-precision — regardless of how the operator typed
    // INGEST_START_AT. A test standing in for "recorded under this same
    // start" must store that same normalized form, not the raw env string.
    const START_ISO = new Date(START).toISOString();
    /** resumeStartAt omitted means "no such field" (a legacy row), not "recorded under no start". */
    const withResume = (resumeFrom: Date | undefined, resumeStartAt?: string | null) =>
      statusModel.findOne.mockReturnValue(query(resumeFrom ? { resumeFrom, resumeStartAt } : null));

    it('is null before any run and without a configured start', async () => {
      withResume(undefined);
      await expect(service.windowStart()).resolves.toBeNull();
    });

    it('is the configured start before the first finished run', async () => {
      process.env.INGEST_START_AT = START;
      withResume(undefined);
      await expect(service.windowStart()).resolves.toEqual(new Date(START));
    });

    it('is the stored resume point when no start is configured now or when it was recorded (after an outage, too)', async () => {
      const resume = new Date('2026-09-20T00:00:00Z');
      withResume(resume, null);
      await expect(service.windowStart()).resolves.toEqual(resume);
    });

    it('is never before the configured start, when the point was recorded under that same start', async () => {
      process.env.INGEST_START_AT = START;
      withResume(new Date('2026-08-01T00:00:00Z'), START_ISO);
      await expect(service.windowStart()).resolves.toEqual(new Date(START));
      withResume(new Date('2026-09-20T00:00:00Z'), START_ISO);
      await expect(service.windowStart()).resolves.toEqual(new Date('2026-09-20T00:00:00Z'));
    });

    // The re-read lever: lowering (or raising, or first setting) INGEST_START_AT
    // must not be a no-op just because a resume point already sits past it —
    // the point only pins the window when it was itself computed under the
    // start that's configured right now.
    it('uses the configured start, ignoring a resume point recorded under a different start', async () => {
      process.env.INGEST_START_AT = START;
      withResume(new Date('2026-09-20T00:00:00Z'), '2026-08-15T00:00:00Z');
      await expect(service.windowStart()).resolves.toEqual(new Date(START));
    });

    // A row saved by the pre-resumeStartAt code has no such field at all. Once
    // a start is configured, that must count as a mismatch (ignored once) —
    // not be silently honoured just because nothing was ever recorded to compare.
    it('uses the configured start, ignoring a legacy point with no resumeStartAt field at all', async () => {
      process.env.INGEST_START_AT = START;
      withResume(new Date('2026-09-20T00:00:00Z'));
      await expect(service.windowStart()).resolves.toEqual(new Date(START));
    });

    it('throws when the status cannot be read, so the run fails instead of guessing', async () => {
      statusModel.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('db down')) }) });
      await expect(service.windowStart()).rejects.toThrow('db down');
    });
  });

  describe('recordResumePoint', () => {
    it('stores the resume point alongside the start it was computed under', async () => {
      const at = new Date('2026-09-23T10:00:00Z');
      await service.recordResumePoint(at, new Date('2026-09-01T00:00:00Z'));
      expect(statusModel.updateOne).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { resumeFrom: at, resumeStartAt: '2026-09-01T00:00:00.000Z' } },
        { upsert: true },
      );
    });

    it('stores a null resumeStartAt when no start is configured', async () => {
      const at = new Date('2026-09-23T10:00:00Z');
      await service.recordResumePoint(at, null);
      expect(statusModel.updateOne).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { resumeFrom: at, resumeStartAt: null } },
        { upsert: true },
      );
    });
  });

  describe('oldestPendingUnreadable', () => {
    // An aggregation, not find().sort().limit(1): $ifNull falls back to
    // receivedAt so a legacy row saved before arrivedAt existed still counts,
    // instead of being silently invisible to $min because the field is missing.
    it('finds the oldest not-dismissed mail, preferring its arrival time over receivedAt', async () => {
      const oldest = new Date('2026-09-10T00:00:00Z');
      unreadableModel.aggregate.mockResolvedValue([{ _id: null, oldest }]);
      await expect(service.oldestPendingUnreadable()).resolves.toEqual(oldest);
      expect(unreadableModel.aggregate).toHaveBeenCalledWith([
        { $match: { userId: 1, dismissed: { $ne: true } } },
        { $group: { _id: null, oldest: { $min: { $ifNull: ['$arrivedAt', '$receivedAt'] } } } },
      ]);
    });

    it('has no oldest waiting mail when the list is empty', async () => {
      unreadableModel.aggregate.mockResolvedValue([]);
      await expect(service.oldestPendingUnreadable()).resolves.toBeNull();
    });

    it('throws when the read fails, so the resume point stays where it was rather than guess', async () => {
      unreadableModel.aggregate.mockRejectedValue(new Error('db down'));
      await expect(service.oldestPendingUnreadable()).rejects.toThrow('db down');
    });
  });

  it('removes a mail from the list once it books', async () => {
    await service.clearUnreadable('m1');
    expect(unreadableModel.deleteOne).toHaveBeenCalledWith({ userId: 1, messageId: 'm1' });
  });

  describe('clearUnreadableMany', () => {
    it('clears every listed id that booked or was recognised since', async () => {
      await service.clearUnreadableMany(['m1', 'm2']);
      expect(unreadableModel.deleteMany).toHaveBeenCalledWith({ userId: 1, messageId: { $in: ['m1', 'm2'] } });
    });

    it('asks nothing for an empty list', async () => {
      await service.clearUnreadableMany([]);
      expect(unreadableModel.deleteMany).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      unreadableModel.deleteMany.mockRejectedValue(new Error('db down'));
      await expect(service.clearUnreadableMany(['m1'])).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('dismissedAmong', () => {
    it('returns the dismissed ones among the given message ids', async () => {
      const rows = query([{ messageId: 'm2' }]);
      unreadableModel.find.mockReturnValue(rows);
      expect(await service.dismissedAmong(['m1', 'm2'])).toEqual(new Set(['m2']));
      expect(unreadableModel.find).toHaveBeenCalledWith({ userId: 1, messageId: { $in: ['m1', 'm2'] }, dismissed: true });
      expect(rows.select).toHaveBeenCalledWith('messageId');
    });

    it('asks nothing for no ids', async () => {
      expect(await service.dismissedAmong([])).toEqual(new Set());
      expect(unreadableModel.find).not.toHaveBeenCalled();
    });

    it('treats a read failure as none dismissed, so the mails are simply retried', async () => {
      unreadableModel.find.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('db down')) }) });
      expect(await service.dismissedAmong(['m1'])).toEqual(new Set());
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('marks the mail dismissed', async () => {
      await service.dismiss(MAIL_ID);
      expect(unreadableModel.findOneAndUpdate).toHaveBeenCalledWith({ _id: MAIL_ID, userId: 1 }, { $set: { dismissed: true } });
    });

    it('is a 404 for a missing mail or a malformed id', async () => {
      unreadableModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(service.dismiss(MAIL_ID)).rejects.toThrow(NotFoundException);
      await expect(service.dismiss('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('view', () => {
    it('shows the last run, the last error, the unreadable mails and what mail booked lately', async () => {
      process.env.INGEST_START_AT = '2026-09-24T14:58:59Z';
      statusModel.findOne.mockReturnValue(
        query({
          lastRunAt: AT,
          created: 1,
          alreadyBooked: 2,
          notTransactions: 3,
          unreadable: 1,
          bookingFailed: 0,
          lastError: 'login refused',
          lastErrorAt: AT,
        }),
      );
      const unreadable = query([
        { _id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT, dismissed: false },
      ]);
      unreadableModel.find.mockReturnValue(unreadable);
      const recent = query([
        { _id: 't1', transactionName: 'store', amount: -120.5, category: 'food', timestamp: AT },
        { _id: 't2', transactionName: 'own savings', amount: -500, category: 'other', timestamp: AT, transferKind: 'internal' },
      ]);
      txModel.find.mockReturnValue(recent);

      expect(await service.view(true)).toEqual({
        // The web's date pipe throws on a malformed date string; INGEST_START_AT
        // is arbitrary operator input, so this must always be a valid ISO string
        // (or null), never the raw env var passed through.
        startAt: '2026-09-24T14:58:59.000Z',
        // No stored resume point in this fixture: readingFrom falls back to the configured start.
        readingFrom: '2026-09-24T14:58:59.000Z',
        running: true,
        lastRun: { at: AT, created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0, unverified: 0 },
        lastError: { at: AT, message: 'login refused' },
        unreadable: [{ id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT, reason: null }],
        recent: [
          { id: 't1', name: 'store', amount: 120.5, isExpense: true, category: 'food', timestamp: AT, transferKind: null },
          { id: 't2', name: 'own savings', amount: 500, isExpense: true, category: 'other', timestamp: AT, transferKind: 'internal' },
        ],
      });
      // Same filter as oldestPendingUnreadable's pin: a row saved before
      // `dismissed` existed (undefined, not false) must still be excluded once
      // it's actually marked dismissed, and included otherwise either way.
      expect(unreadableModel.find).toHaveBeenCalledWith({ userId: 1, dismissed: { $ne: true } });
      expect(unreadable.sort).toHaveBeenCalledWith({ receivedAt: -1 });
      expect(unreadable.limit).toHaveBeenCalledWith(50);
      expect(txModel.find).toHaveBeenCalledWith({ userId: 1, source: 'email', deletedAt: null });
      expect(recent.select).toHaveBeenCalledWith('transactionName amount category timestamp transferKind');
      expect(recent.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(recent.limit).toHaveBeenCalledWith(10);
    });

    // INGEST_START_AT is free-form operator input in the Secret; a typo must
    // not surface as a value the web's date pipe cannot render.
    it('reports no start date when INGEST_START_AT is not a valid date', async () => {
      process.env.INGEST_START_AT = 'not-a-date';
      const v = await service.view(false);
      expect(v.startAt).toBeNull();
    });

    it('shows nothing yet before the first run', async () => {
      const v = await service.view(false);
      expect(v).toEqual({ startAt: null, readingFrom: null, running: false, lastRun: null, lastError: null, unreadable: [], recent: [] });
    });

    it('shows no error once a later run succeeded', async () => {
      statusModel.findOne.mockReturnValue(
        query({
          lastRunAt: AT,
          created: 0,
          alreadyBooked: 0,
          notTransactions: 0,
          unreadable: 0,
          bookingFailed: 0,
          lastError: null,
          lastErrorAt: AT,
        }),
      );
      const v = await service.view(false);
      expect(v.lastError).toBeNull();
    });

    // A record written by the old two-count version keeps its old skipped/failed
    // values, which are no longer read; the new counts read as 0 until the next
    // poll overwrites the record.
    it('reads an old-shaped record (skipped/failed) as all-zero new counts', async () => {
      statusModel.findOne.mockReturnValue(query({ lastRunAt: AT, created: 1, skipped: 5, failed: 2 }));
      const v = await service.view(false);
      expect(v.lastRun).toEqual({ at: AT, created: 1, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 });
    });

    it('shows a non-zero unverified count from the last run', async () => {
      statusModel.findOne.mockReturnValue(
        query({ lastRunAt: AT, created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 3 }),
      );
      const v = await service.view(false);
      expect(v.lastRun?.unverified).toBe(3);
    });

    it("carries an unreadable row's reason through to the view", async () => {
      unreadableModel.find.mockReturnValue(
        query([{ _id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 1, lastSeenAt: AT, reason: "Couldn't verify it came from the bank" }]),
      );
      const v = await service.view(false);
      expect(v.unreadable[0].reason).toBe("Couldn't verify it came from the bank");
    });

    describe('readingFrom', () => {
      it("follows the stored resume point's ISO — even later than the configured start — when it was recorded under that same start", async () => {
        process.env.INGEST_START_AT = '2026-09-01T00:00:00Z';
        const resumeFrom = new Date('2026-09-20T00:00:00Z');
        statusModel.findOne.mockReturnValue(
          query({ resumeFrom, resumeStartAt: new Date('2026-09-01T00:00:00Z').toISOString() }),
        );
        const v = await service.view(false);
        expect(v.readingFrom).toBe(resumeFrom.toISOString());
      });

      it('falls back to the configured start when the stored point was recorded under a different start', async () => {
        process.env.INGEST_START_AT = '2026-09-01T00:00:00Z';
        statusModel.findOne.mockReturnValue(
          query({ resumeFrom: new Date('2026-09-20T00:00:00Z'), resumeStartAt: '2026-08-01T00:00:00Z' }),
        );
        const v = await service.view(false);
        expect(v.readingFrom).toBe('2026-09-01T00:00:00.000Z');
      });
    });
  });
});
