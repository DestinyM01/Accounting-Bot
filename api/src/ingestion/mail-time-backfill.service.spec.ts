import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { BACKFILL_NAME, MailTimeBackfillService } from './mail-time-backfill.service';
import { Migration } from '../shared/schemas/migration.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

const lean = (v: unknown) => ({ lean: jest.fn().mockResolvedValue(v) });
const START = new Date('2026-09-25T18:00:00Z');

describe('MailTimeBackfillService', () => {
  let service: MailTimeBackfillService;
  let migrationModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock };
  let collection: { updateMany: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    migrationModel = {
      findOneAndUpdate: jest.fn(() => lean({ name: BACKFILL_NAME, cutoff: START })),
      findOne: jest.fn(() => lean(null)),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    collection = { updateMany: jest.fn().mockResolvedValue({ modifiedCount: 7 }) };
    const mod = await Test.createTestingModule({
      providers: [
        MailTimeBackfillService,
        { provide: getModelToken(Migration.name), useValue: migrationModel },
        { provide: getModelToken(Transaction.name), useValue: { collection } },
      ],
    }).compile();
    service = mod.get(MailTimeBackfillService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('does nothing unless the server runs in the user zone', async () => {
    await expect(service.run(START, 'UTC')).resolves.toBe(0);
    expect(migrationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(collection.updateMany).not.toHaveBeenCalled();
  });

  it('fixes the cut-off at the first start, then shifts every unmarked mail row from before it by 4 hours, once', async () => {
    await expect(service.run(START)).resolves.toBe(7);
    expect(migrationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { name: BACKFILL_NAME },
      { $setOnInsert: { name: BACKFILL_NAME, cutoff: START } },
      { upsert: true, new: true },
    );
    expect(collection.updateMany).toHaveBeenCalledWith(
      {
        sourceMessageId: { $exists: true },
        _id: { $lt: Types.ObjectId.createFromTime(Math.floor(START.getTime() / 1000)) },
        mailTimeLocal: { $ne: true },
      },
      [{ $set: { timestamp: { $add: ['$timestamp', 4 * 3_600_000] }, mailTimeLocal: true } }],
    );
    expect(migrationModel.updateOne).toHaveBeenCalledWith({ name: BACKFILL_NAME }, { $set: { doneAt: START, shifted: 7 } });
  });

  it('does nothing once the correction is done', async () => {
    migrationModel.findOneAndUpdate.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: START, doneAt: START }));
    await expect(service.run(new Date('2026-10-01T00:00:00Z'))).resolves.toBe(0);
    expect(collection.updateMany).not.toHaveBeenCalled();
  });

  it('reuses the first cut-off when an earlier run did not finish', async () => {
    const earlier = new Date('2026-09-25T12:00:00Z');
    migrationModel.findOneAndUpdate.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: earlier }));
    await service.run(START);
    expect(collection.updateMany.mock.calls[0][0]._id).toEqual({
      $lt: Types.ObjectId.createFromTime(Math.floor(earlier.getTime() / 1000)),
    });
  });

  it('re-reads the marker when another pod created it at the same moment', async () => {
    migrationModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue({ code: 11000 }) });
    migrationModel.findOne.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: START, doneAt: START }));
    await expect(service.run(START)).resolves.toBe(0);
    expect(migrationModel.findOne).toHaveBeenCalledWith({ name: BACKFILL_NAME });
  });

  it('never fails the start: a failure is logged and retried on the next start', async () => {
    collection.updateMany.mockRejectedValue(new Error('db down'));
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
