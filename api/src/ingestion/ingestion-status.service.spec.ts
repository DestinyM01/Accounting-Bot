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
  let unreadableModel: { updateOne: jest.Mock; deleteOne: jest.Mock; deleteMany: jest.Mock; find: jest.Mock; findOneAndUpdate: jest.Mock };
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
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: MAIL_ID }),
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
    await service.recordRun({ created: 1, skipped: 2, failed: 0 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      { $set: { lastRunAt: AT, created: 1, skipped: 2, failed: 0, lastError: null } },
      { upsert: true },
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
    await expect(service.recordRun({ created: 0, skipped: 0, failed: 0 })).resolves.toBeUndefined();
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
        $setOnInsert: { firstSeenAt: AT, dismissed: false },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );
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
        query({ lastRunAt: AT, created: 1, skipped: 2, failed: 1, lastError: 'login refused', lastErrorAt: AT }),
      );
      const unreadable = query([
        { _id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT, dismissed: false },
      ]);
      unreadableModel.find.mockReturnValue(unreadable);
      const recent = query([{ _id: 't1', transactionName: 'store', amount: -120.5, category: 'food', timestamp: AT }]);
      txModel.find.mockReturnValue(recent);

      expect(await service.view(true)).toEqual({
        startAt: '2026-09-24T14:58:59Z',
        running: true,
        lastRun: { at: AT, created: 1, skipped: 2, failed: 1 },
        lastError: { at: AT, message: 'login refused' },
        unreadable: [{ id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT }],
        recent: [{ id: 't1', name: 'store', amount: 120.5, isExpense: true, category: 'food', timestamp: AT }],
      });
      expect(unreadableModel.find).toHaveBeenCalledWith({ userId: 1, dismissed: false });
      expect(unreadable.sort).toHaveBeenCalledWith({ receivedAt: -1 });
      expect(unreadable.limit).toHaveBeenCalledWith(50);
      expect(txModel.find).toHaveBeenCalledWith({ userId: 1, source: 'email', deletedAt: null });
      expect(recent.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(recent.limit).toHaveBeenCalledWith(10);
    });

    it('shows nothing yet before the first run', async () => {
      const v = await service.view(false);
      expect(v).toEqual({ startAt: null, running: false, lastRun: null, lastError: null, unreadable: [], recent: [] });
    });

    it('shows no error once a later run succeeded', async () => {
      statusModel.findOne.mockReturnValue(
        query({ lastRunAt: AT, created: 0, skipped: 0, failed: 0, lastError: null, lastErrorAt: AT }),
      );
      const v = await service.view(false);
      expect(v.lastError).toBeNull();
    });
  });
});
