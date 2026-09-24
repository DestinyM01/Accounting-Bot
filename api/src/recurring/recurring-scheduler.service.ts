import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { Occurrence } from './due-occurrences';

export type BookingOutcome = 'booked' | 'satisfied' | 'failed';

/**
 * Books recurring rules into transactions. Replaces the bot's daily 08:00 cron,
 * which booked only the rules due that exact day and never caught up: the bot
 * was down Sep 17–24 2026 and every rule due that week was silently skipped.
 */
@Injectable()
export class RecurringSchedulerService {
  private readonly logger = new Logger(RecurringSchedulerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Books one occurrence of one rule — at most once, whoever else is writing.
   * 'satisfied' means it was already recorded (by the bank email, or by another
   * api pod during a rollout) and no money moves. Unexpected database errors
   * propagate to the caller.
   */
  async bookOccurrence(rule: Recurring, occurrence: Occurrence, now: Date): Promise<BookingOutcome> {
    const recurringId = String(rule._id);

    // MUST go through the enum: its values are the legacy strings 'Доход'/'Расход'.
    // Sign by type, never by the stored sign. Anything else fails closed.
    const magnitude = Math.abs(rule.amount);
    let signed: number;
    if (rule.transactionType === TransactionType.EXPENSE) signed = -magnitude;
    else if (rule.transactionType === TransactionType.INCOME) signed = magnitude;
    else {
      this.logger.error(`Recurring ${recurringId} has unknown transactionType "${rule.transactionType}"; not booked`);
      return 'failed';
    }

    const existing = await this.txModel.findOne({
      userId: this.userId,
      recurringId,
      recurringPeriod: occurrence.period,
      ...NOT_DELETED,
    });
    if (existing) {
      await this.markHandled(rule, occurrence.period, now);
      return 'satisfied';
    }

    let created: { _id: unknown };
    try {
      created = await this.txModel.create({
        userId: this.userId,
        userName: rule.userName,
        transactionName: rule.transactionName,
        transactionType: rule.transactionType,
        amount: signed,
        timestamp: occurrence.dueAt,
        category: rule.category,
        source: 'recurring',
        recurringId,
        recurringPeriod: occurrence.period,
      });
    } catch (err: any) {
      // The partial unique index on (userId, recurringId, recurringPeriod):
      // another writer recorded this occurrence between our lookup and insert.
      if (err?.code === 11000) {
        await this.markHandled(rule, occurrence.period, now);
        return 'satisfied';
      }
      throw err;
    }

    const id = String(created._id);
    try {
      await this.ledger.apply(signed, 'recurring', rule.transactionName, id);
    } catch (err) {
      // A linked row whose money never moved would be found as 'satisfied' next
      // hour and never retried. Remove it — created milliseconds ago, no
      // sourceMessageId, never returned to a caller — so the next sweep redoes both.
      try {
        await this.txModel.deleteOne({ _id: created._id });
      } catch (rollbackErr) {
        this.logger.error(`Rollback of ${id} failed; row is orphaned`, String(rollbackErr));
      }
      this.logger.error(`Ledger failed booking recurring ${recurringId} for ${occurrence.period}; rolled back`, String(err));
      return 'failed';
    }

    await this.markHandled(rule, occurrence.period, now);
    return 'booked';
  }

  /** Forward-only: lastPeriod never moves back, whatever order writers land in. */
  private async markHandled(rule: Recurring, period: string, now: Date): Promise<void> {
    await this.recurringModel.updateOne(
      { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
      { $set: { lastPeriod: period, lastExecutedAt: now } },
    );
  }
}
