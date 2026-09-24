import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../schemas/balance.schema';
import { BalanceChangeReason, BalanceHistory } from '../schemas/balance-history.schema';

/**
 * The only code in api/ that moves the user's balance. Every write path —
 * ingestion, manual create, edit, delete, resolution — goes through here so
 * the balance and its history can never disagree about what happened.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private readonly historyModel: Model<BalanceHistory>,
  ) {}

  /** Adds a SIGNED delta (expense negative, income positive) and records history. */
  async apply(
    delta: number,
    reason: BalanceChangeReason,
    transactionName?: string,
    transactionId?: string,
  ): Promise<{ previousBalance: number; newBalance: number }> {
    const balance =
      (await this.balanceModel.findOne({ userId: this.userId })) ??
      (await this.balanceModel.create({ userId: this.userId, balance: 0 }));

    const previousBalance = balance.balance;
    balance.balance += delta;
    balance.lastActivity = new Date();
    await balance.save();

    // History failure must never break the movement that already happened.
    try {
      await this.historyModel.create({
        userId: this.userId,
        previousBalance,
        newBalance: balance.balance,
        delta,
        reason,
        transactionName,
        transactionId,
      });
    } catch (err) {
      this.logger.error('Failed to record balance history', String(err));
    }
    return { previousBalance, newBalance: balance.balance };
  }

  /**
   * Undo a stored amount. Works for both signs: a stored expense of -300
   * reverses as +300, a stored income of +500 reverses as -500.
   */
  reverse(storedAmount: number, transactionName?: string, transactionId?: string) {
    return this.apply(-storedAmount, 'delete', transactionName, transactionId);
  }
}
