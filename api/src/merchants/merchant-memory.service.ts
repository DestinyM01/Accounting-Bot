import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { merchantKey } from './merchant-key';

/** The fields of a transaction that decide whether, and what, a category choice teaches. */
export interface TeachableRow {
  _id: unknown;
  source?: string;
  amount: number;
  isWithdrawal?: boolean;
  transferKind?: string | null;
  merchant?: string;
  transactionName?: string;
}

/**
 * Remembers the category the user chose for each bank merchant, so the next
 * charge from it is filed without review, and files the merchant's other rows
 * still waiting for review. Only bank-mail expenses teach: income, ATM
 * withdrawals (always cash) and transfers between own accounts never do.
 */
@Injectable()
export class MerchantMemoryService {
  private readonly logger = new Logger(MerchantMemoryService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(MerchantCategory.name) private readonly memoryModel: Model<MerchantCategory>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  /** Every remembered merchant key → category, for one ingestion run. */
  async all(): Promise<Map<string, string>> {
    const rows = await this.memoryModel.find({ userId: this.userId }).lean();
    return new Map(rows.map((r) => [r.key, r.category]));
  }

  /**
   * Called after the user set `category` on `row` (as it was before the change).
   * Returns how many other waiting rows it filed. Never throws: the user's change
   * is already saved, so a failure here is only logged.
   */
  async learn(row: TeachableRow, category: string): Promise<number> {
    const key = merchantKey(row.merchant || row.transactionName);
    const teaches =
      row.source === 'email' && row.amount < 0 && !row.isWithdrawal && !isNonSpendingTransfer(row.transferKind) && key !== '';
    if (!teaches) return 0;
    try {
      await this.memoryModel.updateOne(
        { userId: this.userId, key },
        { $set: { category, updatedAt: new Date() } },
        { upsert: true },
      );
      const waiting = await this.txModel
        .find({
          userId: this.userId,
          source: 'email',
          categoryNeedsReview: true,
          amount: { $lt: 0 },
          isWithdrawal: { $ne: true },
          ...NOT_DELETED,
          _id: { $ne: row._id },
        })
        .select('merchant transactionName')
        .lean();
      const ids = waiting.filter((t) => merchantKey(t.merchant || t.transactionName) === key).map((t) => t._id);
      if (ids.length === 0) return 0;
      const res = await this.txModel.updateMany(
        { _id: { $in: ids }, categoryNeedsReview: true },
        { $set: { category, categoryNeedsReview: false } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Could not remember ${category} for "${key}"`, err instanceof Error ? err.stack : String(err));
      return 0;
    }
  }
}
