import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { isSchedulableDay, LOOKBACK_DAYS, Occurrence, planOccurrences, schedulableFrom } from './due-occurrences';

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

  // Hourly at minute 5, between the ingestion polls (every 10 minutes from :00).
  // waitForCompletion makes the scheduler itself skip ticks while a sweep is in
  // flight; the running flag covers the same ground for any direct caller of sweep().
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
    if (!isSchedulableDay(rule.dayOfMonth)) {
      this.logger.warn(
        `Recurring ${String(rule._id)} "${rule.transactionName}": dayOfMonth ${rule.dayOfMonth} is not a day from 1 to 28; not booked`,
      );
      return;
    }

    const plan = planOccurrences(schedulableFrom(rule), now);

    // While a failed month is being retried, this sweep handles only that month:
    // marking later too-old months, or booking later months, would move lastPeriod
    // past it (and skip too-old months without their log). The next sweep, with
    // lastPeriod at the retried month, handles the rest the usual way.
    const retrying = !!rule.failedPeriod && plan.due.some((o) => o.period === rule.failedPeriod);
    if (plan.tooOld.length > 0 && !retrying) {
      const periods = plan.tooOld.map((o) => o.period);
      await this.markHandled(rule, periods[periods.length - 1], now);
      tally.skipped += periods.length;
      this.logger.warn(
        `Recurring ${String(rule._id)} "${rule.transactionName}": not booking ${periods.join(', ')}, ` +
          `older than ${LOOKBACK_DAYS} days`,
      );
    }

    const toBook = retrying ? plan.due.filter((o) => o.period === rule.failedPeriod) : plan.due;
    for (const occurrence of toBook) {
      let outcome: BookingOutcome;
      try {
        outcome = await this.bookOccurrence(rule, occurrence, now);
      } catch (err) {
        this.logger.error(
          `Recurring ${String(rule._id)} ${occurrence.period} failed`,
          err instanceof Error ? err.stack : String(err),
        );
        outcome = 'failed';
      }
      tally[outcome]++;
      // lastPeriod only moves forward: booking a newer month after a failure
      // would carry the marker past the failed one, and it would never retry.
      if (outcome === 'failed') {
        // Also requires the month to be unhandled by lastPeriod: two pods can
        // race a retry, and if the other one's booking already landed and
        // markHandled moved lastPeriod to (or past) this period, this pod's
        // late failure must not resurrect the month as failedPeriod.
        await this.recurringModel
          .updateOne(
            {
              _id: rule._id,
              $and: [
                { $or: [{ failedPeriod: { $exists: false } }, { failedPeriod: { $gt: occurrence.period } }] },
                { $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: occurrence.period } }] },
              ],
            },
            { $set: { failedPeriod: occurrence.period } },
          )
          .catch((err) => this.logger.warn(`Could not remember failed ${occurrence.period} of ${String(rule._id)}: ${String(err)}`));
        break;
      }
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

    const signed = signedAmount(rule.transactionType, rule.amount);
    if (signed === null) {
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
      this.logger.log(`Recurring ${recurringId} for ${occurrence.period} already recorded`);
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
        this.logger.log(`Recurring ${recurringId} for ${occurrence.period} already recorded`);
        return 'satisfied';
      }
      throw err;
    }

    const id = String(created._id);
    try {
      await this.ledger.apply(signed, 'recurring', rule.transactionName, id);
    } catch (err) {
      this.logger.error(
        `Ledger failed booking recurring ${recurringId} for ${occurrence.period}; rolling back row ${id}`,
        err instanceof Error ? err.stack : String(err),
      );
      // A linked row whose money never moved would be found as 'satisfied' next
      // hour and never retried. Remove it — created milliseconds ago, no
      // sourceMessageId, not yet returned to any HTTP caller — so the next sweep
      // redoes both. (A second api pod sweeping at the same instant during a
      // rollout could still see it and mark the month handled; that needs a
      // rollout straddling :05 and a ledger failure together, and is accepted.)
      try {
        await this.txModel.deleteOne({ _id: created._id });
      } catch (rollbackErr) {
        this.logger.error(
          `Rollback of ${id} (recurring ${recurringId} ${occurrence.period}) failed: the row exists but the ` +
            `balance did not move, and the next sweep will count it satisfied. Needs manual repair.`,
          String(rollbackErr),
        );
      }
      return 'failed';
    }

    try {
      await this.markHandled(rule, occurrence.period, now);
    } catch (err) {
      // The money moved; only the marker is behind. The next sweep finds the
      // linked row, counts it satisfied and moves the marker, so this heals itself.
      this.logger.warn(
        `Booked recurring ${recurringId} for ${occurrence.period} but could not update its marker; ` +
          `the next sweep will: ${String(err)}`,
      );
    }
    this.logger.log(`Booked recurring ${recurringId} for ${occurrence.period}`);
    return 'booked';
  }

  /** Forward-only: lastPeriod never moves back, whatever order writers land in. A handled month is no longer a failed one. */
  private async markHandled(rule: Recurring, period: string, now: Date): Promise<void> {
    await this.recurringModel.updateOne(
      { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
      { $set: { lastPeriod: period, lastExecutedAt: now }, $unset: { failedPeriod: '' } },
    );
  }
}

/**
 * Signs a rule's amount by its type, never by its stored sign. MUST go through
 * the enum — its values are the legacy strings 'Доход'/'Расход'. Anything else,
 * including the English words, is null: fail closed.
 */
function signedAmount(type: string, amount: number): number | null {
  const magnitude = Math.abs(amount);
  if (type === TransactionType.EXPENSE) return -magnitude;
  if (type === TransactionType.INCOME) return magnitude;
  return null;
}
