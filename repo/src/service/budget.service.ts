import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Budget } from '../mongodb/schemas/budget.schemas';
import { Transaction } from '../type/interface';
import { Category } from '../type/enum/category.enum';
import { TransactionType } from '../type/enum/transactionType.enam';

@Injectable()
export class BudgetService {
  private readonly logger: Logger = new Logger(BudgetService.name);

  constructor(
    @InjectModel('Budget') private readonly budgetModel: Model<Budget>,
    @InjectModel('Transaction') private readonly transactionModel: Model<Transaction>,
  ) {}

  async setBudget(userId: number, category: Category, limitAmount: number): Promise<Budget> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const existing = await this.budgetModel.findOne({ userId, category, month, year }).exec();
    if (existing) {
      existing.limitAmount = limitAmount;
      return existing.save();
    }
    return this.budgetModel.create({ userId, category, limitAmount, month, year });
  }

  async getBudgets(userId: number): Promise<Budget[]> {
    const now = new Date();
    return this.budgetModel.find({ userId, month: now.getMonth() + 1, year: now.getFullYear() }).exec();
  }

  async checkBudget(userId: number, category: Category): Promise<{ limit: number; spent: number; over: boolean } | null> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const budget = await this.budgetModel.findOne({ userId, category, month, year }).exec();
    if (!budget) return null;

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const transactions = await this.transactionModel
      .find({
        userId,
        category,
        transactionType: TransactionType.EXPENSE,
        timestamp: { $gte: startOfMonth, $lte: endOfMonth },
      })
      .exec();

    const spent = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { limit: budget.limitAmount, spent, over: spent > budget.limitAmount };
  }
}
