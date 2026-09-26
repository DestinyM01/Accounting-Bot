import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IngestionStatus } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail } from '../shared/schemas/unreadable-mail.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { parseConfiguredInstant } from '../shared/time-zone';

/** What one ingestion run did with each mail it read. Every mail lands in exactly one of the first five counts. */
export interface RunCounts {
  /** Booked this run. */
  created: number;
  /** Booked before (its message id is known), or a duplicate the database refused. */
  alreadyBooked: number;
  /** Dismissed on the Settings page, recognised as not a transaction, or from a sender no parser takes. */
  notTransactions: number;
  /** The parser couldn't use it; listed as unreadable on the Settings page. */
  unreadable: number;
  /** Read fine but the save failed; retried on the next poll. */
  bookingFailed: number;
  /** Not a sixth bucket: how many of the mails, whichever count they landed in, Gmail couldn't verify. */
  unverified: number;
}

export interface IngestionStatusView {
  startAt: string | null;
  /** Where the next run will actually start reading; see IngestionStatusService.windowStart. */
  readingFrom: string | null;
  running: boolean;
  lastRun: ({ at: Date } & RunCounts) | null;
  lastError: { at: Date; message: string } | null;
  unreadable: { id: string; sender: string; subject: string; receivedAt: Date; attempts: number; lastSeenAt: Date; reason: string | null }[];
  recent: { id: string; name: string; amount: number; isExpense: boolean; category: string; timestamp: Date; transferKind: string | null }[];
}

/**
 * The records behind the Settings page's "Bank mail" section: how the last run
 * went, and the mails no parser could read. Every write here is best effort: a
 * failure is logged and never fails an ingestion run.
 */
@Injectable()
export class IngestionStatusService {
  private readonly logger = new Logger(IngestionStatusService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(IngestionStatus.name) private readonly statusModel: Model<IngestionStatus>,
    @InjectModel(UnreadableMail.name) private readonly unreadableModel: Model<UnreadableMail>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  async recordRun(counts: RunCounts, at = new Date()): Promise<void> {
    await this.quietly('record the run', () =>
      this.statusModel.updateOne(
        { userId: this.userId },
        {
          $set: {
            lastRunAt: at,
            created: counts.created,
            alreadyBooked: counts.alreadyBooked,
            notTransactions: counts.notTransactions,
            unreadable: counts.unreadable,
            bookingFailed: counts.bookingFailed,
            unverified: counts.unverified,
            lastError: null,
          },
          // The old counts are no longer in the schema; strict: false lets this one write remove them.
          $unset: { skipped: '', failed: '' },
        },
        { upsert: true, strict: false },
      ),
    );
  }

  async recordFailure(err: unknown, at = new Date()): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await this.quietly('record the failed run', () =>
      this.statusModel.updateOne({ userId: this.userId }, { $set: { lastError: message, lastErrorAt: at } }, { upsert: true }),
    );
  }

  async recordUnreadable(
    mail: { messageId: string; sender: string; subject: string; receivedAt: Date; arrivedAt?: Date; reason?: string },
    at = new Date(),
  ): Promise<void> {
    await this.quietly(`record unreadable mail ${mail.messageId}`, () =>
      this.unreadableModel.updateOne(
        { userId: this.userId, messageId: mail.messageId },
        {
          $set: {
            sender: mail.sender,
            subject: mail.subject,
            receivedAt: mail.receivedAt,
            lastSeenAt: at,
            ...(mail.arrivedAt ? { arrivedAt: mail.arrivedAt } : {}),
            ...(mail.reason ? { reason: mail.reason } : {}),
          },
          ...(mail.reason ? {} : { $unset: { reason: '' } }),
          $setOnInsert: { firstSeenAt: at, dismissed: false },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      ),
    );
  }

  /**
   * Forgets unreadable mails received before the reading window: they can't be
   * fetched again, so they would sit on the list forever. Dismissals are kept, in
   * case the start date moves back.
   */
  async forgetUnreadableBefore(since: Date): Promise<void> {
    await this.quietly('forget unreadable mails outside the window', () =>
      this.unreadableModel.deleteMany({ userId: this.userId, receivedAt: { $lt: since }, dismissed: { $ne: true } }),
    );
  }

  /**
   * Where the next run starts reading: the stored resume point, never before
   * INGEST_START_AT; the start alone before the first finished run; null when
   * there is neither (the caller then reads the last 24 hours). A failed read
   * throws: the run fails rather than guess a window.
   *
   * The stored point counts only when it was itself computed under today's
   * configured start (see resumeUnderCurrentStart) — otherwise it's ignored
   * once, so lowering (or raising, or first setting) INGEST_START_AT actually
   * re-reads from the new start instead of a stale point shadowing it forever.
   */
  async windowStart(): Promise<Date | null> {
    const status = await this.statusModel.findOne({ userId: this.userId }).select('resumeFrom resumeStartAt').lean();
    const start = parseConfiguredInstant(process.env.INGEST_START_AT);
    return windowFrom(start, resumeUnderCurrentStart(status, start));
  }

  /** Where the next run should start, and the configured start it was computed under; see IngestionService.updateResumePoint. */
  async recordResumePoint(resumeFrom: Date, configuredStart: Date | null): Promise<void> {
    await this.quietly('record where the next run starts', () =>
      this.statusModel.updateOne(
        { userId: this.userId },
        { $set: { resumeFrom, resumeStartAt: configuredStart?.toISOString() ?? null } },
        { upsert: true },
      ),
    );
  }

  /**
   * When the oldest mail still on the unreadable list (not dismissed)
   * arrived; null when there is none. Throws on a failed read. An
   * aggregation, not find().sort().limit(1): $ifNull falls back to
   * receivedAt so a legacy row saved before arrivedAt existed still counts,
   * rather than being invisible to $min because the field is simply missing.
   */
  async oldestPendingUnreadable(): Promise<Date | null> {
    const [row] = await this.unreadableModel.aggregate([
      { $match: { userId: this.userId, dismissed: { $ne: true } } },
      { $group: { _id: null, oldest: { $min: { $ifNull: ['$arrivedAt', '$receivedAt'] } } } },
    ]);
    return row?.oldest ? new Date(row.oldest) : null;
  }

  async clearUnreadable(messageId: string): Promise<void> {
    await this.quietly(`clear unreadable mail ${messageId}`, () =>
      this.unreadableModel.deleteOne({ userId: this.userId, messageId }),
    );
  }

  /** Clears any of these message ids from the unreadable list: they booked or were recognised since. */
  async clearUnreadableMany(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.quietly('clear booked mails from the unreadable list', () =>
      this.unreadableModel.deleteMany({ userId: this.userId, messageId: { $in: messageIds } }),
    );
  }

  /** The dismissed ones among these message ids. On a read failure, none: those mails are then simply retried. */
  async dismissedAmong(messageIds: string[]): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    try {
      const rows = await this.unreadableModel
        .find({ userId: this.userId, messageId: { $in: messageIds }, dismissed: true })
        .select('messageId')
        .lean();
      return new Set(rows.map((r) => r.messageId));
    } catch (err) {
      this.logger.error('Could not read dismissed mails; retrying them this run', err instanceof Error ? err.stack : String(err));
      return new Set();
    }
  }

  async dismiss(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such mail');
    const row = await this.unreadableModel.findOneAndUpdate({ _id: id, userId: this.userId }, { $set: { dismissed: true } });
    if (!row) throw new NotFoundException('No such mail');
  }

  async view(running: boolean): Promise<IngestionStatusView> {
    const [status, unreadable, recent] = await Promise.all([
      this.statusModel.findOne({ userId: this.userId }).lean(),
      // Same filter as the resume-point pin (oldestPendingUnreadable): a row
      // saved before `dismissed` existed (undefined, not false) must still
      // show up here, not be silently excluded by an exact-false match.
      this.unreadableModel.find({ userId: this.userId, dismissed: { $ne: true } }).sort({ receivedAt: -1 }).limit(50).lean(),
      this.txModel
        .find({ userId: this.userId, source: 'email', ...NOT_DELETED })
        .sort({ timestamp: -1 })
        .limit(10)
        .select('transactionName amount category timestamp transferKind')
        .lean(),
    ]);
    // The web's date pipe throws on a malformed date string, and
    // INGEST_START_AT is free-form operator input in the Secret — never pass
    // it through unvalidated.
    const start = parseConfiguredInstant(process.env.INGEST_START_AT);
    const startAt = start?.toISOString() ?? null;
    return {
      startAt,
      readingFrom: windowFrom(start, resumeUnderCurrentStart(status, start))?.toISOString() ?? null,
      running,
      lastRun: status?.lastRunAt
        ? {
            at: status.lastRunAt,
            created: status.created ?? 0,
            alreadyBooked: status.alreadyBooked ?? 0,
            notTransactions: status.notTransactions ?? 0,
            unreadable: status.unreadable ?? 0,
            bookingFailed: status.bookingFailed ?? 0,
            unverified: status.unverified ?? 0,
          }
        : null,
      lastError: status?.lastError && status.lastErrorAt ? { at: status.lastErrorAt, message: status.lastError } : null,
      unreadable: unreadable.map((u) => ({
        id: String(u._id),
        sender: u.sender,
        subject: u.subject,
        receivedAt: u.receivedAt,
        attempts: u.attempts,
        lastSeenAt: u.lastSeenAt,
        reason: u.reason ?? null,
      })),
      recent: recent.map((t) => ({
        id: String(t._id),
        name: t.transactionName,
        amount: Math.abs(t.amount),
        isExpense: t.amount < 0,
        category: t.category,
        timestamp: t.timestamp,
        transferKind: t.transferKind ?? null,
      })),
    };
  }

  private async quietly(what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      this.logger.error(`Could not ${what}`, err instanceof Error ? err.stack : String(err));
    }
  }
}

/** The later of the configured start and the stored resume point, whichever exist. */
function windowFrom(start: Date | null, resumeFrom: Date | null | undefined): Date | null {
  const resume = resumeFrom ? new Date(resumeFrom) : null;
  if (start && resume) return resume > start ? resume : start;
  return resume ?? start;
}

/**
 * The stored resumeFrom, but only when it was computed under today's
 * configured start — undefined (a legacy row with no such field at all)
 * counts as null, same as no start configured when it was recorded. A
 * mismatch means the point is stale: ignored once, until the next run
 * re-stamps it under the start that's configured now.
 *
 * Except: no currently configured start always keeps the point, regardless
 * of what it was recorded under. A removed floor asks for no re-read, not a
 * full reset — treating it as a mismatch would fall back to windowFrom(null,
 * null), and watermark() would then default to the last 24 hours, silently
 * losing everything between there and the point (an outage, a streak of
 * failed bookings, days of a stuck pin) the moment INGEST_START_AT is unset.
 */
function resumeUnderCurrentStart(status: { resumeFrom?: Date; resumeStartAt?: string | null } | null | undefined, start: Date | null): Date | null | undefined {
  const currentStart = start?.toISOString() ?? null;
  if (currentStart === null) return status?.resumeFrom;
  const recordedUnder = status?.resumeStartAt ?? null;
  return recordedUnder === currentStart ? status?.resumeFrom : null;
}
