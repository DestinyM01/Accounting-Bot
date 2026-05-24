import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';

@Injectable()
export class StatisticsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
  ) {}

  /** Current-month summary: total income, total expense, net */
  async summary(month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const txs = await this.transactionModel
      .find({ userId: this.userId, timestamp: { $gte: start, $lt: end } })
      .select('amount')
      .lean();

    const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    return {
      month: m,
      year: y,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      net: Math.round((income - expense) * 100) / 100,
      transactionCount: txs.length,
    };
  }

  /** Last 12 months bar-chart data */
  async monthly() {
    const results = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d;
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const txs = await this.transactionModel
        .find({ userId: this.userId, timestamp: { $gte: start, $lt: end } })
        .select('amount')
        .lean();

      const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const expense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

      results.push({
        label: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
        income: Math.round(income * 100) / 100,
        expense: Math.round(expense * 100) / 100,
      });
    }

    return results;
  }

  /** Expense breakdown by category for current month */
  async byCategory(month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const txs = await this.transactionModel
      .find({ userId: this.userId, timestamp: { $gte: start, $lt: end }, amount: { $lt: 0 } })
      .select('amount category')
      .lean();

    const grouped: Record<string, number> = {};
    for (const t of txs) {
      const cat = t.category || 'other';
      grouped[cat] = (grouped[cat] || 0) + Math.abs(t.amount);
    }

    return Object.entries(grouped)
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
  }
}
