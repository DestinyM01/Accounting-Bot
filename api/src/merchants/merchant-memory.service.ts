import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { Category } from '../shared/schemas/category.enum';
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

/** The names a row carries; its merchant key comes from `merchant` first, else `transactionName`. */
interface NamedRow {
  _id: unknown;
  merchant?: string;
  transactionName?: string;
}

const keyOf = (t: NamedRow): string => merchantKey(t.merchant || t.transactionName);

/**
 * cash is only for ATM cash, and other is the "don't know" bucket:
 * remembering either would skip the AI for that merchant forever.
 */
const NEVER_REMEMBERED: readonly string[] = [Category.CASH, Category.OTHER];

/**
 * A merchant's rows are the user's live bank-mail expenses that aren't ATM
 * withdrawals or transfers between own accounts, filtered in code by key.
 * Only these rows teach, get filed, get counted and get moved.
 */
const MERCHANT_ROWS = {
  source: 'email',
  amount: { $lt: 0 },
  isWithdrawal: { $ne: true },
  transferKind: { $nin: [...NON_SPENDING_KINDS] },
  ...NOT_DELETED,
};

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
    // A category deleted with a move into Other moves its remembered merchants there too;
    // "don't know" is never remembered, so such an entry is skipped rather than obeyed.
    return new Map(rows.filter((r) => !NEVER_REMEMBERED.includes(r.category)).map((r) => [r.key, r.category]));
  }

  /**
   * Called after the user set `category` on `row` (as it was before the change).
   * Returns how many other waiting rows it filed. Never throws: the user's change
   * is already saved, so a failure here is only logged.
   */
  async learn(row: TeachableRow, category: string): Promise<number> {
    if (NEVER_REMEMBERED.includes(category)) return 0;
    const key = keyOf(row);
    const teaches =
      row.source === 'email' && row.amount < 0 && !row.isWithdrawal && !isNonSpendingTransfer(row.transferKind) && key !== '';
    if (!teaches) return 0;
    try {
      await this.memoryModel.updateOne(
        { userId: this.userId, key },
        { $set: { category, updatedAt: new Date() } },
        { upsert: true },
      );
      return await this.fileWaiting(key, category, row._id);
    } catch (err) {
      this.logger.error(`Could not remember ${category} for "${key}"`, err instanceof Error ? err.stack : String(err));
      return 0;
    }
  }

  /** The merchant rows (MERCHANT_ROWS) that also match `extra`, with only their names. */
  private async merchantRows(extra: FilterQuery<Transaction> = {}): Promise<NamedRow[]> {
    return await this.txModel
      .find({ userId: this.userId, ...MERCHANT_ROWS, ...extra })
      .select('merchant transactionName')
      .lean<NamedRow[]>();
  }

  /** Files the rows from `key` still waiting for review (all but `exceptId`) under `category`; returns how many. */
  private async fileWaiting(key: string, category: string, exceptId?: unknown): Promise<number> {
    const waiting = await this.merchantRows({
      categoryNeedsReview: true,
      ...(exceptId === undefined ? {} : { _id: { $ne: exceptId } }),
    });
    const ids = waiting.filter((t) => keyOf(t) === key).map((t) => t._id);
    if (ids.length === 0) return 0;
    const res = await this.txModel.updateMany(
      { _id: { $in: ids }, categoryNeedsReview: true, ...NOT_DELETED },
      { $set: { category, categoryNeedsReview: false } },
    );
    return res.modifiedCount;
  }
}
