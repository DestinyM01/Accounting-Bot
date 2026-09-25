import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Budget } from '../shared/schemas/budget.schema';
import { CategoriesService } from '../categories/categories.service';
import { CategorySpendService } from '../cash/category-spend.service';

@Injectable()
export class BudgetService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Budget.name) private budgetModel: Model<Budget>,
    private readonly categories: CategoriesService,
    private readonly spend: CategorySpendService,
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
    // Itemized cash counts toward its category's budget (see CategorySpendService).
    const spentBy = new Map((await this.spend.byCategory(start, end)).map((c) => [c.category, c.total]));

    return budgets.map((b) => {
      const spent = spentBy.get(b.category) ?? 0;
      return {
        category: b.category,
        limit: b.limitAmount,
        spent,
        remaining: Math.round((b.limitAmount - spent) * 100) / 100,
        percentage: Math.min(100, Math.round((spent / b.limitAmount) * 100)),
        month: m,
        year: y,
      };
    });
  }

  async set(category: string, limitAmount: number, month?: number, year?: number): Promise<void> {
    await this.categories.assertValid(category);
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    await this.budgetModel.findOneAndUpdate(
      { userId: this.userId, category, month: m, year: y },
      { limitAmount },
      { upsert: true },
    );
  }
}
