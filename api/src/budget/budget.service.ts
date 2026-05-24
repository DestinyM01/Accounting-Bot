import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Budget } from '../shared/schemas/budget.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

@Injectable()
export class BudgetService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Budget.name) private budgetModel: Model<Budget>,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
  ) {}

  async get(month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    const budgets = await this.budgetModel
      .find({ userId: this.userId, month: m, year: y })
      .lean();

    if (!budgets.length) return [];

    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    // Fetch all expense transactions for this month once
    const expenses = await this.transactionModel
      .find({ userId: this.userId, timestamp: { $gte: start, $lt: end }, amount: { $lt: 0 } })
      .select('category amount')
      .lean();

    return budgets.map((b) => {
      const spent = expenses
        .filter((t) => t.category === b.category)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      return {
        category: b.category,
        limit: b.limitAmount,
        spent: Math.round(spent * 100) / 100,
        remaining: Math.round((b.limitAmount - spent) * 100) / 100,
        percentage: Math.min(100, Math.round((spent / b.limitAmount) * 100)),
        month: m,
        year: y,
      };
    });
  }
}
