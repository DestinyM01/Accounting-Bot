import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { HALF_CENT, money } from '../cash/cash-rules';

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
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
  needsReview?: boolean;
  transferKind?: string;
  unitemized?: boolean;
}

export interface ExportQuery {
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
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

export interface TransactionPage {
  items: TransactionItem[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class TransactionsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    private readonly ledger: LedgerService,
    private readonly categories: CategoriesService,
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
      filter.amount = { $lt: 0 };
      filter.$expr = { $gt: [{ $abs: '$amount' }, { $add: [{ $ifNull: ['$allocatedCash', 0] }, HALF_CENT] }] };
    }
    // An explicit transferKind request (e.g. listing only 'unresolved' ones to
    // classify) wins over the expense-only exclusion above.
    if (query.transferKind) filter.transferKind = query.transferKind;
    if (query.startDate || query.endDate) {
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }
    return filter;
  }

  async findAll(query: TransactionQuery): Promise<TransactionPage> {
    const filter = this.buildFilter(query);
    const limit  = Math.min(query.limit || 50, 200);
    const offset = query.offset || 0;

    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
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

    return { items: normalised, total, limit, offset };
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
      const date = new Date(t.timestamp).toISOString().slice(0, 10);
      // Internal/unresolved rows are visible but tagged: printing them as
      // 'expense' would let a spreadsheet sum on Type=expense double-count a
      // transfer alongside the real payment it funded.
      const isTransfer = isNonSpendingTransfer(t.transferKind);
      const type   = isTransfer ? 'transfer' : (t.amount < 0 ? 'expense' : 'income');
      const kind   = t.transferKind || '';
      const amount = Math.abs(t.amount).toFixed(2);
      const name   = t.transactionName.replace(/"/g, '""');
      return `"${date}","${name}","${type}","${t.category || 'other'}","${kind}","${amount}"`;
    }).join('\n');

    return header + rows;
  }

  async setCategory(id: string, category: string): Promise<void> {
    await this.categories.assertValid(category);
    await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { category, categoryNeedsReview: false },
    );
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

  async update(id: string, body: UpdateTransactionBody): Promise<void> {
    const tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
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
        throw new BadRequestException(`${money(tx.allocatedCash ?? 0)} of this withdrawal is itemized — remove items first`);
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
    const matched = await this.transactionModel.findOneAndUpdate(
      {
        _id: id,
        userId: this.userId,
        ...NOT_DELETED,
        amount: tx.amount,
        transferKind: tx.transferKind ?? null,   // null matches an absent field
        // A withdrawal whose amount changes must still cover what's itemized: an
        // item added since the read above would otherwise slip under the new amount.
        ...(tx.isWithdrawal && patch.amount !== undefined
          ? { $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, Math.abs(patch.amount as number) + HALF_CENT] } }
          : {}),
      },
      { $set: patch },
    );
    if (!matched) throw new ConflictException('transaction changed concurrently; reload and retry');

    if (delta !== 0) {
      try {
        await this.ledger.apply(delta, 'manual', tx.transactionName, id);
      } catch (err) {
        // The row was stored but the balance did not move. Put back every
        // field the patch touched — not just amount — so a retry starts from
        // the exact pre-image instead of a hybrid of old and new values.
        const restore: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) restore[k] = (tx as any)[k] ?? null;
        return this.compensate({ id, what: 'update' }, () => this.transactionModel.updateOne({ _id: id }, { $set: restore }), err);
      }
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
