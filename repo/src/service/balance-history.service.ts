import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BalanceHistory, BalanceChangeReason } from '../mongodb/schemas/balance-history.schemas';

@Injectable()
export class BalanceHistoryService {
  private readonly logger: Logger = new Logger(BalanceHistoryService.name);

  constructor(
    @InjectModel('BalanceHistory')
    private readonly historyModel: Model<BalanceHistory>,
  ) {}

  async record(
    userId: number,
    previousBalance: number,
    newBalance: number,
    reason: BalanceChangeReason,
    transactionName?: string,
    transactionId?: string,
  ): Promise<void> {
    try {
      await this.historyModel.create({
        userId,
        previousBalance,
        newBalance,
        delta: newBalance - previousBalance,
        reason,
        transactionName,
        transactionId,
      });
    } catch (err) {
      // History failure must never break the main transaction flow
      this.logger.error(`Failed to record balance history for user ${userId}`, err);
    }
  }

  async getRecent(userId: number, limit = 20): Promise<BalanceHistory[]> {
    return this.historyModel
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
