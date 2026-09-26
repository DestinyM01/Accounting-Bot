import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../schemas/balance.schema';
import { BalanceChangeReason, BalanceHistory } from '../schemas/balance-history.schema';

/**
 * The only code in api/ that moves the user's balance. Every write path —
 * ingestion, manual create, edit, delete, resolution — must go through here
 * so the balance and its history can never disagree about what happened.
 * seq numbers every change in the order the balance saw them; history sorts by it.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private readonly historyModel: Model<BalanceHistory>,
  ) {}

  /** A history failure is logged and never undoes the movement that already happened. */
  private async recordHistory(row: {
    previousBalance: number;
    newBalance: number;
    delta: number;
    reason: BalanceChangeReason;
    transactionName?: string;
    transactionId?: string;
    seq?: number;
  }): Promise<void> {
    try {
      await this.historyModel.create({ userId: this.userId, ...row });
    } catch (err) {
      this.logger.error('Failed to record balance history', String(err));
    }
  }

  /** Adds a SIGNED delta (expense negative, income positive) and records history. */
  async apply(
    delta: number,
    reason: BalanceChangeReason,
    transactionName?: string,
    transactionId?: string,
  ): Promise<{ previousBalance: number; newBalance: number }> {
    // A single atomic $inc: concurrent writers (the ingestion poll and the web)
    // can never lose each other's update the way a read-modify-write can.
    const updated = await this.balanceModel.findOneAndUpdate(
      { userId: this.userId },
      { $inc: { balance: delta, seq: 1 }, $set: { lastActivity: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const newBalance = updated.balance;
    const previousBalance = newBalance - delta;

    await this.recordHistory({ previousBalance, newBalance, delta, reason, transactionName, transactionId, seq: updated.seq });
    return { previousBalance, newBalance };
  }

  /**
   * Undo a stored amount. Works for both signs: a stored expense of -300
   * reverses as +300, a stored income of +500 reverses as -500.
   */
  reverse(
    storedAmount: number,
    transactionName?: string,
    transactionId?: string,
  ): Promise<{ previousBalance: number; newBalance: number }> {
    return this.apply(-storedAmount, 'delete', transactionName, transactionId);
  }

  /**
   * Sets the balance to an absolute total: the user's correction against their
   * real accounts. One atomic write; the replaced value comes from the
   * pre-image, so no movement landing at the same moment can be lost. An
   * unchanged total records nothing.
   */
  async setTo(
    target: number,
    note?: string,
  ): Promise<{ previousBalance: number; newBalance: number; delta: number }> {
    const before = await this.balanceModel.findOneAndUpdate(
      { userId: this.userId },
      { $set: { balance: target, lastActivity: new Date() }, $inc: { seq: 1 } },
      { upsert: true, new: false, setDefaultsOnInsert: true },
    );
    const previousBalance = before?.balance ?? 0;
    const delta = Math.round((target - previousBalance) * 100) / 100;

    if (delta !== 0) {
      await this.recordHistory({ previousBalance, newBalance: target, delta, reason: 'manual', transactionName: note, seq: (before?.seq ?? 0) + 1 });
    }
    return { previousBalance, newBalance: target, delta };
  }
}
