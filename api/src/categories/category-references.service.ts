import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Budget } from '../shared/schemas/budget.schema';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';

export interface Usage {
  transactions: number;
  recurring: number;
  budgets: number;
}

export const NO_USAGE: Usage = { transactions: 0, recurring: 0, budgets: 0 };

/** The three collections that name categories: how much uses each name, and moving them all to another. */
@Injectable()
export class CategoryReferencesService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    @InjectModel(Budget.name) private readonly budgetModel: Model<Budget>,
  ) {}

  /** Live transactions, active recurring rules and budgets (any month) per category name. */
  async usage(): Promise<Map<string, Usage>> {
    const byCategory = [{ $group: { _id: '$category', n: { $sum: 1 } } }];
    const [tx, rules, budgets] = await Promise.all([
      this.txModel.aggregate([{ $match: { userId: this.userId, ...NOT_DELETED } }, ...byCategory]),
      this.recurringModel.aggregate([{ $match: { userId: this.userId, active: true } }, ...byCategory]),
      this.budgetModel.aggregate([{ $match: { userId: this.userId } }, ...byCategory]),
    ]);

    const usage = new Map<string, Usage>();
    const entry = (name: unknown): Usage => {
      const key = String(name);
      if (!usage.has(key)) usage.set(key, { ...NO_USAGE });
      return usage.get(key);
    };
    for (const r of tx) entry(r._id).transactions = r.n;
    for (const r of rules) entry(r._id).recurring = r.n;
    for (const r of budgets) entry(r._id).budgets = r.n;
    return usage;
  }

  /**
   * Moves every reference from one category name to another. Each step only
   * touches rows still under `from`, so re-running it — after it completed or
   * after it was interrupted — never changes anything already moved.
   */
  async migrate(from: string, to: string): Promise<void> {
    // Deleted transactions and inactive rules too: nothing may name a dead category.
    await this.txModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });
    await this.recurringModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });

    const budgets = await this.budgetModel.find({ userId: this.userId, category: from }).lean();
    for (const b of budgets) {
      const target = await this.budgetModel
        .findOne({ userId: this.userId, category: to, month: b.month, year: b.year })
        .lean();
      if (!target) {
        await this.budgetModel.updateOne({ _id: b._id, category: from }, { $set: { category: to } });
        continue;
      }
      // Delete first, then add: an interruption between the two under-counts
      // the budget (it warns early) rather than double-counting it.
      const moved = await this.budgetModel.findOneAndDelete({ _id: b._id, category: from }).lean();
      if (moved) await this.budgetModel.updateOne({ _id: target._id }, { $inc: { limitAmount: moved.limitAmount } });
    }
  }
}
