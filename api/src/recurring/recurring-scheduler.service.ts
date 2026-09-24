import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { LOOKBACK_DAYS, Occurrence, planOccurrences } from './due-occurrences';

export type BookingOutcome = 'booked' | 'satisfied' | 'failed';

interface Tally {
  booked: number;
  satisfied: number;
  skipped: number;
  failed: number;
}

/**
 * Books recurring rules into transactions. Replaces the bot's daily 08:00 cron,
 * which booked only the rules due that exact day and never caught up: the bot
 * was down Sep 17–24 2026 and every rule due that week was silently skipped.
 */
@Injectable()
export class RecurringSchedulerService {
  private readonly logger = new Logger(RecurringSchedulerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private running = false;

  constructor(
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    private readonly ledger: LedgerService,
  ) {}

  /** Hourly at minute 5 — between the ingestion polls, which run every 10 minutes from :00. */
  @Cron('5 * * * *', { waitForCompletion: true })
  async poll(): Promise<void> {
    await this.sweep(new Date());
  }

  /**
   * Books every occurrence that is due, not yet handled, and at most
   * LOOKBACK_DAYS old. On-time booking and catch-up are the same path, so the
   * catch-up logic runs every day, not only after an outage.
   */
  async sweep(now: Date): Promise<void> {
    if (this.running) {
      this.logger.warn('Recurring sweep skipped: previous run still in flight');
      return;
    }
    this.running = true;
    const tally: Tally = { booked: 0, satisfied: 0, skipped: 0, failed: 0 };
    try {
      const rules = await this.recurringModel.find({ userId: this.userId, active: true });
      for (const rule of rules) {
        try {
          await this.processRule(rule, now, tally);
        } catch (err) {
          tally.failed++;
          this.logger.error(`Recurring ${String(rule._id)} failed`, err instanceof Error ? err.stack : String(err));
        }
      }
      this.logger.log(
        `Recurring sweep: booked ${tally.booked}, satisfied ${tally.satisfied}, ` +
          `skipped ${tally.skipped} (older than ${LOOKBACK_DAYS} days), failed ${tally.failed}`,
      );
    } catch (err) {
      this.logger.error('Recurring sweep failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processRule(rule: Recurring, now: Date, tally: Tally): Promise<void> {
    const plan = planOccurrences(
      {
        dayOfMonth: rule.dayOfMonth,
        // The ObjectId, not the createdAt field: createdAt defaults to "now" on
        // legacy rules stored without it, which would block their catch-up.
        createdAt: (rule._id as Types.ObjectId).getTimestamp(),
        lastPeriod: rule.lastPeriod,
        lastExecutedAt: rule.lastExecutedAt,
      },
      now,
    );

    if (plan.tooOld.length > 0) {
      const periods = plan.tooOld.map((o) => o.period);
      await this.markHandled(rule, periods[periods.length - 1], now);
      tally.skipped += periods.length;
      this.logger.warn(
        `Recurring ${String(rule._id)} "${rule.transactionName}": not booking ${periods.join(', ')}, ` +
          `older than ${LOOKBACK_DAYS} days`,
      );
    }

    for (const occurrence of plan.due) {
      const outcome = await this.bookOccurrence(rule, occurrence, now);
      tally[outcome]++;
      // lastPeriod only moves forward: booking a newer month after a failure
      // would carry the marker past the failed one, and it would never retry.
      if (outcome === 'failed') break;
    }
  }

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
