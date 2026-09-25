import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { Category } from '../shared/schemas/category.enum';
import { merchantKey } from './merchant-key';
import { CategoriesService } from '../categories/categories.service';

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

/** A remembered merchant as the Merchants page shows it. */
export interface RememberedMerchant {
  id: string;
  key: string;
  category: string;
  updatedAt: Date | null;
  /** How many booked rows (MERCHANT_ROWS) carry this key. */
  rows: number;
  /** False when its category was deleted, or is cash or other: ingestion then ignores it. */
  usable: boolean;
}

/** What a typed merchant name would match. An empty key means it can't identify a merchant. */
export interface MerchantMatch {
  key: string;
  rows: number;
  remembered: string | null;
}

/** The longest merchant name accepted; bank names are far shorter. */
const MAX_NAME = 200;

/** The names a row carries; its merchant key comes from `merchant` first, else `transactionName`. */
interface NamedRow {
  _id: unknown;
  merchant?: string;
  transactionName?: string;
}

const keyOf = (t: NamedRow): string => merchantKey(t.merchant || t.transactionName);

/** Capitalises a category name's first letter, the way the web shows it. */
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

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
    private readonly categories: CategoriesService,
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

  /** Every remembered merchant, sorted by key, with its booked rows and whether its category can still be used. */
  async list(): Promise<RememberedMerchant[]> {
    const [entries, rows, usable] = await Promise.all([
      this.memoryModel.find({ userId: this.userId }).lean(),
      this.merchantRows(),
      this.usableCategories(),
    ]);
    const counts = new Map<string, number>();
    for (const t of rows) {
      const key = keyOf(t);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return entries
      .map((e) => ({
        id: String(e._id),
        key: e.key,
        category: e.category,
        updatedAt: e.updatedAt ?? null,
        rows: counts.get(e.key) ?? 0,
        usable: usable.has(e.category),
      }))
      .sort((a, b) => a.key.localeCompare(b.key, 'es'));
  }

  /** The key a typed name produces, how many booked rows carry it, and the category already remembered for it. */
  async match(name: unknown): Promise<MerchantMatch> {
    const key = typeof name === 'string' && name.length <= MAX_NAME ? merchantKey(name) : '';
    if (!key) return { key: '', rows: 0, remembered: null };
    const [rows, entry] = await Promise.all([
      this.merchantRows(),
      this.memoryModel.findOne({ userId: this.userId, key }).lean(),
    ]);
    return { key, rows: rows.filter((t) => keyOf(t) === key).length, remembered: entry?.category ?? null };
  }

  /** Remembers a merchant typed by hand, then files its rows waiting for review. */
  async add(name: unknown, category: unknown): Promise<{ id: string; key: string; alsoFiled: number }> {
    if (typeof name !== 'string' || name.length > MAX_NAME) {
      throw new BadRequestException(`name must be text of at most ${MAX_NAME} characters`);
    }
    const key = merchantKey(name);
    if (!key) throw new BadRequestException("That name can't identify a merchant");
    const chosen = await this.assertUsable(category);
    const existing = await this.memoryModel.findOne({ userId: this.userId, key }).lean();
    // Adding never moves history: an existing merchant is changed from its row in the list.
    if (existing) throw new ConflictException(`Already remembered as ${title(existing.category)}; change it in the list`);
    let created: { _id: unknown };
    try {
      created = await this.memoryModel.create({ userId: this.userId, key, category: chosen, updatedAt: new Date() });
    } catch (err) {
      // Two adds of the same name at once: the unique index on { userId, key } lets only one in.
      if ((err as { code?: number } | null)?.code === 11000) {
        throw new ConflictException('Already remembered; change it in the list');
      }
      throw err;
    }
    let alsoFiled = 0;
    try {
      alsoFiled = await this.fileWaiting(key, chosen);
    } catch (err) {
      // The merchant is remembered; its waiting rows are filed by the next ✓ on one of them.
      this.logger.error(`Could not file waiting rows for "${key}"`, err instanceof Error ? err.stack : String(err));
    }
    return { id: String(created._id), key, alsoFiled };
  }

  /**
   * Changes a merchant's category. Its rows still in the old category, and its
   * rows waiting for review, move first; the memory follows only if it still
   * holds the old category or already holds the chosen one — a double-submit
   * of the same choice from another tab then succeeds instead of 409ing.
   * Anything else in between still answers 409. If the memory update fails, a
   * retry is safe: the moved rows are no longer in the old category.
   */
  async change(id: string, category: unknown): Promise<{ moved: number }> {
    const chosen = await this.assertUsable(category);
    const entry = Types.ObjectId.isValid(id)
      ? await this.memoryModel.findOne({ _id: id, userId: this.userId }).lean()
      : null;
    if (!entry) throw new NotFoundException('That merchant is no longer remembered');
    const old = entry.category;
    if (old === chosen) return { moved: 0 };
    const stillOld = { $or: [{ category: old }, { categoryNeedsReview: true }] };
    const ids = (await this.merchantRows(stillOld)).filter((t) => keyOf(t) === entry.key).map((t) => t._id);
    let moved = 0;
    if (ids.length > 0) {
      const res = await this.txModel.updateMany(
        { _id: { $in: ids }, ...NOT_DELETED, ...stillOld },
        { $set: { category: chosen, categoryNeedsReview: false } },
      );
      moved = res.modifiedCount;
    }
    const res = await this.memoryModel.updateOne(
      { _id: entry._id, userId: this.userId, category: { $in: [old, chosen] } },
      { $set: { category: chosen, updatedAt: new Date() } },
    );
    if (res.matchedCount === 0) {
      throw new ConflictException('This merchant changed at the same time; some of its rows may have moved. Check the list and try again.');
    }
    return { moved };
  }

  /** Forgets a merchant. Its booked rows stay as they are; its next mail goes back to the AI with review. */
  async forget(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.memoryModel.deleteOne({ _id: id, userId: this.userId });
  }

  /** The active categories a merchant can be remembered under. */
  private async usableCategories(): Promise<Set<string>> {
    const names = (await this.categories.list()).map((c) => c.name);
    return new Set(names.filter((n) => !NEVER_REMEMBERED.includes(n)));
  }

  /** 400 unless `category` is an active category other than cash or other; returns it. */
  private async assertUsable(category: unknown): Promise<string> {
    if (typeof category !== 'string' || !category) throw new BadRequestException('category is required');
    if (NEVER_REMEMBERED.includes(category)) throw new BadRequestException('Cash and Other are never remembered');
    if (!(await this.usableCategories()).has(category)) throw new BadRequestException(`${category} is not an active category`);
    return category;
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
