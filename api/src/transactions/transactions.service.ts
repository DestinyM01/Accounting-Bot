import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { localDateKey, localDayEnd, localDayStart } from '../shared/time-zone';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { MerchantMemoryService } from '../merchants/merchant-memory.service';
import { HALF_CENT, money } from '../cash/cash-rules';
import { CounterRepairService } from '../cash/counter-repair.service';
import { afterTime, encodeTimeCursor, parseTimeCursor } from '../shared/cursor';
import { escapeRegExp } from '../shared/escape-regexp';

export interface CreateTransactionBody {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  timestamp?: string;
}

export interface UpdateTransactionBody {
  name?: string;
  category?: string;
  amount?: number;
  timestamp?: string;
}

export interface SetCategoryBody {
  category: string;
}

export interface ResolveTransferBody {
  kind: 'internal' | 'external';
}

export interface TransactionQuery {
  limit?: number;
  offset?: number;
  before?: string;
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
  needsReview?: boolean;
  transferKind?: string;
  unitemized?: boolean;
  search?: string;
}

export interface ExportQuery {
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface TransactionItem {
  _id: unknown;
  transactionName: string;
  transactionType: string;
  amount: number;
  isExpense: boolean;
  timestamp: Date;
  category: string;
  categoryNeedsReview?: boolean;
  merchant?: string;
  source?: string;
  transferKind?: string;
  isWithdrawal?: boolean;
  allocatedCash?: number;
}

/**
 * A quoted CSV cell for free text. A leading =, +, -, @ (even after spaces),
 * tab or carriage return would make a spreadsheet run the cell as a formula
 * (a bank merchant's name is third-party text), so such a value gets a
 * leading apostrophe, which spreadsheets show as plain text.
 */
function csvText(value: string): string {
  const safe = /^\s*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export interface TransactionPage {
  items: TransactionItem[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
}

@Injectable()
export class TransactionsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    private readonly ledger: LedgerService,
    private readonly categories: CategoriesService,
    private readonly memory: MerchantMemoryService,
    private readonly counters: CounterRepairService,
  ) {}

  /**
   * Runs a compensation after a failed ledger call, then rethrows the LEDGER
   * error — that is the one worth surfacing. If the compensation itself fails
   * the row is in a state no retry can repair: say so loudly, with the id.
   */
  private async compensate({ id, what }: { id: string; what: string }, undo: () => Promise<unknown>, ledgerErr: unknown): Promise<never> {
    try {
      await undo();
    } catch (undoErr) {
      this.logger.error(`Rollback of ${what} for ${id} failed; row needs manual repair`, String(undoErr));
    }
    throw ledgerErr;
  }

  private buildFilter(query: ExportQuery & { needsReview?: boolean; transferKind?: string; unitemized?: boolean }): Record<string, any> {
    const filter: any = { userId: this.userId, ...NOT_DELETED };
    // Internal/unresolved rows stay visible, tagged, in an unfiltered listing
    // so the money trail is auditable and an unresolved transfer can still be
    // found and classified there.
    // Only the expense view excludes them, since neither one is spending.
    if (query.type === 'expense') {
      filter.transferKind = { $nin: [...NON_SPENDING_KINDS] };
    }
    if (query.type === 'income')  filter.amount = { $gt: 0 };
    if (query.type === 'expense') filter.amount = { $lt: 0 };
    if (query.category) filter.category = query.category;
    if (query.needsReview) filter.categoryNeedsReview = true;
    // Withdrawals with cash still to itemize (see CashService). The half cent
    // absorbs floating-point drift in the allocatedCash counter.
    if (query.unitemized) {
      filter.isWithdrawal = true;
      filter.amount = { ...(filter.amount ?? {}), $lt: 0 };
      filter.$expr = { $gt: [{ $abs: '$amount' }, { $add: [{ $ifNull: ['$allocatedCash', 0] }, HALF_CENT] }] };
    }
    // An explicit transferKind request (e.g. listing only 'unresolved' ones to
    // classify) wins over the expense-only exclusion above.
    if (query.transferKind) filter.transferKind = query.transferKind;
    if (query.startDate || query.endDate) {
      // The page sends calendar days (YYYY-MM-DD) in the user's zone; new Date('YYYY-MM-DD')
      // would read them as UTC midnight and, in the user's zone, drop the whole end day.
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = this.day(localDayStart, query.startDate, 'startDate');
      if (query.endDate) filter.timestamp.$lte = this.day(localDayEnd, query.endDate, 'endDate');
    }
    // Names, merchants and categories, as the search box always matched. The
    // term is literal text, never a pattern. The cursor wraps the whole filter
    // in $and, so this $or can't collide with the cursor's own. A non-string
    // (an object or array — Express's extended query parser turns
    // ?search[$ne]=x or ?search=a&search=b into one of those) or a NUL byte is
    // ignored rather than failing the request.
    const term = typeof query.search === 'string' ? query.search.replace(/\0/g, '').trim().slice(0, 100) : '';
    if (term) {
      const rx = new RegExp(escapeRegExp(term), 'i');
      filter.$or = [{ transactionName: rx }, { merchant: rx }, { category: rx }];
    }
    return filter;
  }

  private day(read: (day: string) => Date | null, value: string, name: string): Date {
    const date = read(value);
    if (!date) throw new BadRequestException(`${name} must be a date like 2026-09-30 (got ${value})`);
    return date;
  }

  async findAll(query: TransactionQuery): Promise<TransactionPage> {
    const filter = this.buildFilter(query);
    const limit  = Math.min(query.limit || 50, 200);
    const offset = query.offset || 0;

    // "Load more" continues after the last row shown (a cursor), so rows that
    // leave or join the filtered set between loads never shift a page.
    let pageFilter: Record<string, unknown> = filter;
    if (query.before) {
      const cursor = parseTimeCursor(query.before);
      if (!cursor) throw new BadRequestException('before must be a cursor from a previous page');
      pageFilter = { $and: [filter, afterTime(cursor)] };
    }

    let find = this.transactionModel.find(pageFilter).sort({ timestamp: -1, _id: -1 });
    if (!query.before && offset) find = find.skip(offset);
    const [items, total] = await Promise.all([
      find
        .limit(limit)
        .select('transactionName transactionType amount timestamp category categoryNeedsReview merchant source transferKind isWithdrawal allocatedCash')
        .lean(),
      this.transactionModel.countDocuments(filter),
    ]);

    const normalised = items.map((t) => ({
      ...t,
      amount:    Math.abs(t.amount),
      isExpense: t.amount < 0,
    }));
    const last = items[items.length - 1];
    const nextCursor = items.length === limit && last ? encodeTimeCursor(last.timestamp, last._id) : null;

    return { items: normalised, total, limit, offset, nextCursor };
  }

  async exportCsv(query: ExportQuery): Promise<string> {
    const filter = this.buildFilter(query);
    const txs = await this.transactionModel
      .find(filter)
      .limit(10000)
      .sort({ timestamp: -1 })
      .select('transactionName transactionType amount timestamp category transferKind')
      .lean();

    const header = 'Date,Name,Type,Category,Kind,Amount\n';
    const rows = txs.map((t) => {
      const date = localDateKey(new Date(t.timestamp));
      // Internal/unresolved rows are visible but tagged: printing them as
      // 'expense' would let a spreadsheet sum on Type=expense double-count a
      // transfer alongside the real payment it funded.
      const isTransfer = isNonSpendingTransfer(t.transferKind);
      const type   = isTransfer ? 'transfer' : (t.amount < 0 ? 'expense' : 'income');
      const kind   = t.transferKind || '';
      const amount = Math.abs(t.amount).toFixed(2);
      return `"${date}",${csvText(t.transactionName)},"${type}",${csvText(t.category || 'other')},"${kind}","${amount}"`;
    }).join('\n');

    return header + rows;
  }

  /** Sets a row's category and clears its review flag; a bank-mail expense also teaches the merchant memory. */
  async setCategory(id: string, category: string): Promise<{ alsoFiled: number }> {
    await this.categories.assertValid(category);
    const before = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { category, categoryNeedsReview: false },
    );
    if (!before) return { alsoFiled: 0 };
    return { alsoFiled: await this.memory.learn(before, category) };
  }

  private assertPositive(amount: number): void {
    if (typeof amount !== 'number' || !(amount > 0)) throw new BadRequestException(`amount must be > 0 (got ${amount})`);
  }

  async create(body: CreateTransactionBody): Promise<{ id: string }> {
    const { type, amount, name, category, timestamp } = body;
    if (type !== 'income' && type !== 'expense') throw new BadRequestException(`type must be income or expense (got ${type})`);
    this.assertPositive(amount);
    if (!name?.trim()) throw new BadRequestException('name is required');
    await this.categories.assertValid(category);

    const ts = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(ts.getTime())) throw new BadRequestException(`timestamp is invalid (got ${timestamp})`);

    const signed = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    const doc = await this.transactionModel.create({
      userId: this.userId,
      userName: 'web',
      // The bot lowercases names; matching keeps search and analytics grouping consistent.
      transactionName: name.trim().toLowerCase(),
      transactionType: type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: signed,
      timestamp: ts,
      category,
      source: 'manual',
    });
    try {
      await this.ledger.apply(signed, type, doc.transactionName, String(doc._id));
    } catch (err) {
      // The row exists but the balance did not move. Remove the row so a retry
      // starts clean; leaving it would invite a DELETE that reverses a movement
      // that never happened. Permitted hard delete: a row this call created
      // milliseconds ago, with no sourceMessageId — the same rule as ingestion's rollback.
      return this.compensate({ id: String(doc._id), what: 'create' }, () => this.transactionModel.deleteOne({ _id: doc._id }), err);
    }
    return { id: String(doc._id) };
  }

  /** The concurrency guard for update(): the row must still carry the amount and
   * kind the delta was computed from, and — for a withdrawal whose amount
   * shrinks — still have room for what's itemized. */
  private writeGuarded(id: string, pre: any, patch: Record<string, unknown>) {
    return this.transactionModel.findOneAndUpdate(
      {
        _id: id,
        userId: this.userId,
        ...NOT_DELETED,
        amount: pre.amount,
        transferKind: pre.transferKind ?? null,   // null matches an absent field
        // A withdrawal whose amount changes must still cover what's itemized: an
        // item added since the read above would otherwise slip under the new amount.
        ...(pre.isWithdrawal && patch.amount !== undefined
          ? { $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, Math.abs(patch.amount as number) + HALF_CENT] } }
          : {}),
      },
      { $set: patch },
    );
  }

  /**
   * A guarded miss on a withdrawal's amount edit can mean another tab's
   * itemize call raised allocatedCash between the pre-check read and this
   * guarded write — a live reservation, not a stuck counter. Repairing here
   * would erase that reservation and allow over-itemizing, so this never
   * calls counters.repair; it only re-reads to pick the right error. If the
   * row is gone, or its amount/kind no longer match the pre-image, someone
   * else changed it: an ordinary concurrent-change conflict. If it's still
   * the same row and its counter genuinely blocks the new amount, say so
   * plainly instead of the generic conflict. Anything else also falls
   * through to the conflict.
   */
  private async reportGuardedMiss(id: string, tx: any, patch: Record<string, unknown>): Promise<never> {
    if (tx.isWithdrawal && patch.amount !== undefined) {
      const reread = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
      if (reread && reread.amount === tx.amount && (reread.transferKind ?? null) === (tx.transferKind ?? null)) {
        const stillBlocked = Math.abs(patch.amount as number) + HALF_CENT < (reread.allocatedCash ?? 0);
        if (stillBlocked) {
          throw new BadRequestException(`${money(reread.allocatedCash ?? 0)} of this withdrawal is itemized — remove items first`);
        }
      }
    }
    throw new ConflictException('transaction changed concurrently; reload and retry');
  }

  async update(id: string, body: UpdateTransactionBody): Promise<void> {
    let tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
    if (!tx) throw new NotFoundException();

    const patch: Record<string, unknown> = {};

    // Same order as create's checks. Type is not editable here, so there is
    // no type check; the rest lines up: amount, name, category, timestamp.
    let delta = 0;
    if (body.amount !== undefined) {
      this.assertPositive(body.amount);
      // The stored sign is the direction; never re-derive it from the enum here.
      const newSigned = tx.amount < 0 ? -Math.abs(body.amount) : Math.abs(body.amount);
      patch.amount = newSigned;
      // A withdrawal can't shrink below what's already itemized (see CashService).
      if (tx.isWithdrawal && Math.abs(newSigned) + HALF_CENT < (tx.allocatedCash ?? 0)) {
        // A counter left above its items blocks an honest edit: repair it once and look again.
        if (await this.counters.repair(id)) {
          tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
          if (!tx) throw new NotFoundException();
        }
        if (tx.isWithdrawal && Math.abs(newSigned) + HALF_CENT < (tx.allocatedCash ?? 0)) {
          throw new BadRequestException(`${money(tx.allocatedCash ?? 0)} of this withdrawal is itemized — remove items first`);
        }
      }
      // internal / unresolved rows never moved the balance, so a new amount must not either.
      if (!isNonSpendingTransfer(tx.transferKind)) delta = newSigned - tx.amount;
    }
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new BadRequestException('name is required');
      patch.transactionName = body.name.trim().toLowerCase();
    }
    if (body.category !== undefined) {
      await this.categories.assertValid(body.category);
      patch.category = body.category;
      patch.categoryNeedsReview = false;
    }
    if (body.timestamp !== undefined) {
      const ts = new Date(body.timestamp);
      if (isNaN(ts.getTime())) throw new BadRequestException(`timestamp is invalid (got ${body.timestamp})`);
      patch.timestamp = ts;
    }

    if (Object.keys(patch).length === 0) return;

    // Guarded write: the row must still be live and still carry the amount and
    // kind the delta was computed from. A concurrent delete, edit or resolution
    // changes one of those; the filter then misses and nothing is applied.
    // Named `matched`, not `written`: it's only a truthiness check here — `tx`
    // above still carries the pre-image the delta was computed from.
    const matched = await this.writeGuarded(id, tx, patch);
    if (!matched) {
      // Never repair here — see reportGuardedMiss: a miss can mean a live
      // reservation from another tab, and repairing would erase it.
      await this.reportGuardedMiss(id, tx, patch);
    }

    if (delta !== 0) {
      try {
        await this.ledger.apply(delta, 'manual', tx.transactionName, id);
      } catch (err) {
        // The row was stored but the balance did not move. Put back every
        // field the patch touched — not just amount — so a retry starts from
        // the exact pre-image instead of a hybrid of old and new values.
        const restore: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) restore[k] = (tx as any)[k] ?? null;
        // A withdrawal's rollback must not shrink it below items added since the
        // edit made room for them: check that inside the same write.
        const covered = tx.isWithdrawal && patch.amount !== undefined
          ? { $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, Math.abs(tx.amount) + HALF_CENT] } }
          : {};
        return this.compensate({ id, what: 'update' }, async () => {
          const res = await this.transactionModel.updateOne({ _id: id, ...covered }, { $set: restore });
          if (res.matchedCount === 0) throw new Error('items were itemized after the edit; the old amount no longer covers them');
        }, err);
      }
    }

    // Only a real choice teaches: the web edit form always sends `category`,
    // so a name-only fix must not re-teach the category unchanged. A waiting
    // row's guess confirmed through this same form is still a real choice.
    if (body.category !== undefined && (body.category !== tx.category || tx.categoryNeedsReview)) {
      await this.memory.learn(tx, body.category);
    }
  }

  async softDelete(id: string): Promise<void> {
    // One atomic step that matches only a LIVE row and marks it. It returns the
    // pre-image, so the amount reversed below comes from the same operation that
    // won the race: two concurrent deletes cannot both reverse the balance.
    //
    // $unset the recurring link so the row leaves the partial unique index on
    // (userId, recurringId, recurringPeriod). Otherwise the bank email for that
    // period can never be recorded — its create collides with this deleted row —
    // and, having no sourceMessageId to dedupe on, is re-parsed on every poll.
    // ($exists: false is not allowed in a partialFilterExpression, so the index
    // itself cannot be taught to ignore deleted rows.)
    const tx = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { $set: { deletedAt: new Date() }, $unset: { recurringId: 1, recurringPeriod: 1 } },
    );
    if (!tx) throw new NotFoundException();
    if (!isNonSpendingTransfer(tx.transferKind)) {
      try {
        await this.ledger.reverse(tx.amount, tx.transactionName, id);
      } catch (err) {
        // Put the row back exactly as it was so the delete can be retried;
        // otherwise the deletedAt guard 404s forever and the balance never reverses.
        const restore: Record<string, unknown> = {};
        if (tx.recurringId) restore.recurringId = tx.recurringId;
        if (tx.recurringPeriod) restore.recurringPeriod = tx.recurringPeriod;
        const undo = () => this.transactionModel.updateOne(
          { _id: id },
          Object.keys(restore).length ? { $unset: { deletedAt: 1 }, $set: restore } : { $unset: { deletedAt: 1 } },
        );
        return this.compensate({ id, what: 'softDelete' }, undo, err);
      }
    }
  }

  /**
   * The single path from "recorded" to "asserted". The atomic findOneAndUpdate
   * on transferKind: 'unresolved' is the concurrency guard — two racing
   * resolutions cannot both apply the balance.
   */
  async resolveTransfer(id: string, kind: 'internal' | 'external'): Promise<void> {
    if (kind !== 'internal' && kind !== 'external') throw new BadRequestException(`kind must be internal or external (got ${kind})`);
    const tx = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, transferKind: 'unresolved', ...NOT_DELETED },
      { $set: { transferKind: kind } },
    );
    if (!tx) {
      // This second query only runs on the failure path, to tell apart WHY the
      // atomic update above missed: "no live row" (404) from "live but not
      // unresolved" (409). Either way the balance is unreachable from here —
      // a row this query would find was never asserted by this call.
      const live = await this.transactionModel.exists({ _id: id, userId: this.userId, ...NOT_DELETED });
      if (!live) throw new NotFoundException();
      throw new ConflictException('only an unresolved transfer can be resolved');
    }
    if (kind === 'external') {
      try {
        await this.ledger.apply(tx.amount, tx.amount < 0 ? 'expense' : 'income', tx.transactionName, id);
      } catch (err) {
        return this.compensate({ id, what: 'resolveTransfer' }, () => this.transactionModel.updateOne({ _id: id }, { $set: { transferKind: 'unresolved' } }), err);
      }
    }
  }
}
