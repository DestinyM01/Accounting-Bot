import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IngestionStatus } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail } from '../shared/schemas/unreadable-mail.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';

export interface RunCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface IngestionStatusView {
  startAt: string | null;
  running: boolean;
  lastRun: ({ at: Date } & RunCounts) | null;
  lastError: { at: Date; message: string } | null;
  unreadable: { id: string; sender: string; subject: string; receivedAt: Date; attempts: number; lastSeenAt: Date }[];
  recent: { id: string; name: string; amount: number; isExpense: boolean; category: string; timestamp: Date }[];
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
        { $set: { lastRunAt: at, created: counts.created, skipped: counts.skipped, failed: counts.failed, lastError: null } },
        { upsert: true },
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
    mail: { messageId: string; sender: string; subject: string; receivedAt: Date },
    at = new Date(),
  ): Promise<void> {
    await this.quietly(`record unreadable mail ${mail.messageId}`, () =>
      this.unreadableModel.updateOne(
        { userId: this.userId, messageId: mail.messageId },
        {
          $set: { sender: mail.sender, subject: mail.subject, receivedAt: mail.receivedAt, lastSeenAt: at },
          $setOnInsert: { firstSeenAt: at, dismissed: false },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      ),
    );
  }

  async clearUnreadable(messageId: string): Promise<void> {
    await this.quietly(`clear unreadable mail ${messageId}`, () =>
      this.unreadableModel.deleteOne({ userId: this.userId, messageId }),
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
      this.unreadableModel.find({ userId: this.userId, dismissed: false }).sort({ lastSeenAt: -1 }).limit(50).lean(),
      this.txModel
        .find({ userId: this.userId, source: 'email', ...NOT_DELETED })
        .sort({ timestamp: -1 })
        .limit(10)
        .select('transactionName amount category timestamp')
        .lean(),
    ]);
    return {
      startAt: process.env.INGEST_START_AT?.trim() || null,
      running,
      lastRun: status?.lastRunAt
        ? { at: status.lastRunAt, created: status.created ?? 0, skipped: status.skipped ?? 0, failed: status.failed ?? 0 }
        : null,
      lastError: status?.lastError && status.lastErrorAt ? { at: status.lastErrorAt, message: status.lastError } : null,
      unreadable: unreadable.map((u) => ({
        id: String(u._id),
        sender: u.sender,
        subject: u.subject,
        receivedAt: u.receivedAt,
        attempts: u.attempts,
        lastSeenAt: u.lastSeenAt,
      })),
      recent: recent.map((t) => ({
        id: String(t._id),
        name: t.transactionName,
        amount: Math.abs(t.amount),
        isExpense: t.amount < 0,
        category: t.category,
        timestamp: t.timestamp,
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
