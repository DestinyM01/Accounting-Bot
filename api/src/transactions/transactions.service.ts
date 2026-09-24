import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';

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

export interface TransactionQuery {
  limit?: number;
  offset?: number;
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
  needsReview?: boolean;
  transferKind?: string;
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

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    private readonly ledger: LedgerService,
    private readonly categories: CategoriesService,
  ) {}

  private buildFilter(query: ExportQuery & { needsReview?: boolean; transferKind?: string }): Record<string, any> {
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
        .select('transactionName transactionType amount timestamp category categoryNeedsReview merchant source transferKind')
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
    await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { category, categoryNeedsReview: false },
    );
  }

  private async assertCategory(category: string): Promise<void> {
    const allowed = (await this.categories.list()).map((c) => c.name);
    if (!allowed.includes(category)) throw new BadRequestException(`unknown category: ${category}`);
  }

  private assertPositive(amount: number): void {
    if (typeof amount !== 'number' || !(amount > 0)) throw new BadRequestException('amount must be > 0');
  }

  async create(body: CreateTransactionBody): Promise<{ id: string }> {
    const { type, amount, name, category, timestamp } = body;
    if (type !== 'income' && type !== 'expense') throw new BadRequestException('type must be income or expense');
    this.assertPositive(amount);
    if (!name?.trim()) throw new BadRequestException('name is required');
    await this.assertCategory(category);

    const ts = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(ts.getTime())) throw new BadRequestException('timestamp is invalid');

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
      await this.transactionModel.deleteOne({ _id: doc._id });
      throw err;
    }
    return { id: String(doc._id) };
  }

  async update(id: string, body: UpdateTransactionBody): Promise<void> {
    const tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
    if (!tx) throw new NotFoundException();

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (!body.name.trim()) throw new BadRequestException('name is required');
      patch.transactionName = body.name.trim().toLowerCase();
    }
    if (body.category !== undefined) {
      await this.assertCategory(body.category);
      patch.category = body.category;
      patch.categoryNeedsReview = false;
    }
    if (body.timestamp !== undefined) {
      const ts = new Date(body.timestamp);
      if (isNaN(ts.getTime())) throw new BadRequestException('timestamp is invalid');
      patch.timestamp = ts;
    }

    let delta = 0;
    if (body.amount !== undefined) {
      this.assertPositive(body.amount);
      // The stored sign is the direction; never re-derive it from the enum here.
      const newSigned = tx.amount < 0 ? -Math.abs(body.amount) : Math.abs(body.amount);
      patch.amount = newSigned;
      // internal / unresolved rows never moved the balance, so a new amount must not either.
      if (!isNonSpendingTransfer(tx.transferKind)) delta = newSigned - tx.amount;
    }

    if (Object.keys(patch).length === 0) return;

    // Guarded write: the row must still be live and still carry the amount and
    // kind the delta was computed from. A concurrent delete, edit or resolution
    // changes one of those; the filter then misses and nothing is applied.
    const written = await this.transactionModel.findOneAndUpdate(
      {
        _id: id,
        userId: this.userId,
        ...NOT_DELETED,
        amount: tx.amount,
        transferKind: tx.transferKind ?? null,   // null matches an absent field
      },
      { $set: patch },
    );
    if (!written) throw new ConflictException('transaction changed concurrently; reload and retry');

    if (delta !== 0) {
      try {
        await this.ledger.apply(delta, 'manual', tx.transactionName, id);
      } catch (err) {
        // The amount was stored but the balance did not move. Put the amount
        // back so a retry starts from a consistent row instead of drifting.
        await this.transactionModel.updateOne({ _id: id }, { $set: { amount: tx.amount } });
        throw err;
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
        await this.transactionModel.updateOne(
          { _id: id },
          Object.keys(restore).length ? { $unset: { deletedAt: 1 }, $set: restore } : { $unset: { deletedAt: 1 } },
        );
        throw err;
      }
    }
  }

  /**
   * The single path from "recorded" to "asserted". The atomic findOneAndUpdate
   * on transferKind: 'unresolved' is the concurrency guard — two racing
   * resolutions cannot both apply the balance.
   */
  async resolveTransfer(id: string, kind: 'internal' | 'external'): Promise<void> {
    if (kind !== 'internal' && kind !== 'external') throw new BadRequestException('kind must be internal or external');
    const tx = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, transferKind: 'unresolved', ...NOT_DELETED },
      { $set: { transferKind: kind } },
    );
    if (!tx) {
      const live = await this.transactionModel.exists({ _id: id, userId: this.userId, ...NOT_DELETED });
      if (!live) throw new NotFoundException();
      throw new ConflictException('only an unresolved transfer can be resolved');
    }
    if (kind === 'external') {
      try {
        await this.ledger.apply(tx.amount, tx.amount < 0 ? 'expense' : 'income', tx.transactionName, id);
      } catch (err) {
        await this.transactionModel.updateOne({ _id: id }, { $set: { transferKind: 'unresolved' } });
        throw err;
      }
    }
  }
}
