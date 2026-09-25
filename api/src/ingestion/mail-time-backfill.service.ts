import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Migration } from '../shared/schemas/migration.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { serverTimeZone } from '../shared/time-zone';
import { SANTO_DOMINGO_OFFSET_HOURS } from '../shared/santo-domingo';

export const BACKFILL_NAME = 'mail-times-to-santo-domingo';
const USER_ZONE = 'America/Santo_Domingo';
/** Santo Domingo is UTC−4 all year; the Dominican Republic has no DST. */
const SHIFT_MS = SANTO_DOMINGO_OFFSET_HOURS * 3_600_000;

/**
 * Bank-mail times were read as if they were UTC until the api ran in the user's
 * zone, so every mail-sourced row booked before then is exactly 4 hours early.
 * On the first start in the right zone this shifts each such row once. Every
 * shifted row is marked, so a crash, a retry or two pods starting together
 * never shift a row twice. Balances are untouched: only `timestamp` moves.
 */
@Injectable()
export class MailTimeBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailTimeBackfillService.name);

  constructor(
    @InjectModel(Migration.name) private readonly migrationModel: Model<Migration>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  onApplicationBootstrap(): void {
    // In the background: a slow or failed correction never holds up or fails the start.
    this.run(new Date()).catch((err) =>
      this.logger.error('Mail-time correction failed; it runs again on the next start', err instanceof Error ? err.stack : String(err)),
    );
  }

  async run(now: Date, zone: string = serverTimeZone()): Promise<number> {
    if (zone !== USER_ZONE) {
      this.logger.error(
        `Mail-time correction skipped: the server runs in ${zone}, not ${USER_ZONE}. Bank-mail times are unaffected, but days and months in filters, exports and reports follow the server's zone; set TZ=${USER_ZONE}.`,
      );
      return 0;
    }
    const marker = await this.claim(now);
    if (!marker || marker.doneAt) return 0;

    const cutoff = Types.ObjectId.createFromTime(Math.floor(new Date(marker.cutoff).getTime() / 1000));
    // The raw collection: mailTimeLocal is set inside an update pipeline, which Mongoose doesn't cast.
    const res = await this.txModel.collection.updateMany(
      { sourceMessageId: { $exists: true }, _id: { $lt: cutoff }, mailTimeLocal: { $ne: true } },
      [{ $set: { timestamp: { $add: ['$timestamp', SHIFT_MS] }, mailTimeLocal: true } }],
    );
    await this.migrationModel.updateOne(
      { name: BACKFILL_NAME },
      { $set: { doneAt: new Date() }, $inc: { shifted: res.modifiedCount } },
    );
    this.logger.log(`Mail-time correction: moved ${res.modifiedCount} mail-sourced transactions 4 hours later`);
    return res.modifiedCount;
  }

  /** The marker, created with this start as its cut-off if it doesn't exist yet. */
  private async claim(now: Date): Promise<{ cutoff: Date; doneAt?: Date } | null> {
    try {
      return await this.migrationModel
        .findOneAndUpdate({ name: BACKFILL_NAME }, { $setOnInsert: { name: BACKFILL_NAME, cutoff: now } }, { upsert: true, new: true })
        .lean();
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      return this.migrationModel.findOne({ name: BACKFILL_NAME }).lean(); // another pod created it at the same moment
    }
  }
}
