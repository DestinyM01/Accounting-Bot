import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface TransactionQuery {
  limit?: number;
  offset?: number;
  type?: 'income' | 'expense';
  category?: string;
}

export interface TransactionItem {
  _id: unknown;
  transactionName: string;
  transactionType: string;
  amount: number;
  isExpense: boolean;
  timestamp: Date;
  category: string;
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
  ) {}

  async findAll(query: TransactionQuery): Promise<TransactionPage> {
    const filter: any = { userId: this.userId };

    if (query.type === 'income') filter.amount = { $gt: 0 };
    if (query.type === 'expense') filter.amount = { $lt: 0 };
    if (query.category) filter.category = query.category;

    const limit = Math.min(query.limit || 50, 200);
    const offset = query.offset || 0;

    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .select('transactionName transactionType amount timestamp category')
        .lean(),
      this.transactionModel.countDocuments(filter),
    ]);

    // Normalise amounts — expenses are negative in DB, display as positive
    const normalised = items.map((t) => ({
      ...t,
      amount: Math.abs(t.amount),
      isExpense: t.amount < 0,
    }));

    return { items: normalised, total, limit, offset };
  }
}
