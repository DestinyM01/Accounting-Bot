import { BadRequestException, Injectable } from '@nestjs/common';
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
    await this.ledger.apply(signed, type, name.trim(), String(doc._id));
    return { id: String(doc._id) };
  }
}
