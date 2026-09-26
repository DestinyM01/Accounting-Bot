import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Budget } from '../shared/schemas/budget.schema';
import { CategoriesService } from '../categories/categories.service';
import { CategorySpendService } from '../cash/category-spend.service';

/** The largest limit a budget accepts. */
const MAX_LIMIT = 1e9;

@Injectable()
export class BudgetService implements OnModuleInit {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    @InjectModel(Budget.name) private budgetModel: Model<Budget>,
    private readonly categories: CategoriesService,
    private readonly spend: CategorySpendService,
  ) {}

  onModuleInit(): void {
    // Mongoose swallows an index-build failure; the $init promise is cached, so this sees the same result.
    this.budgetModel.init().catch((err) =>
      this.logger.error(
        'Could not build the unique index on budgets; two budgets probably share a category and month. Remove the duplicate in MongoDB and restart.',
        err instanceof Error ? err.stack : String(err),
      ),
    );
  }

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
        percentage: b.limitAmount > 0 ? Math.min(100, Math.round((spent / b.limitAmount) * 100)) : 0,
        month: m,
        year: y,
      };
    });
  }

  async set(category: string, limitAmount: number, month?: number, year?: number): Promise<void> {
    if (typeof limitAmount !== 'number' || !Number.isFinite(limitAmount) || limitAmount <= 0 || limitAmount > MAX_LIMIT) {
      throw new BadRequestException('limitAmount must be a number above 0 and at most 1,000,000,000');
    }
    if (month !== undefined && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
      throw new BadRequestException('month must be a whole number from 1 to 12');
    }
    if (year !== undefined && !(Number.isInteger(year) && year >= 2000 && year <= 2100)) {
      throw new BadRequestException('year must be a whole number from 2000 to 2100');
    }
    await this.categories.assertValid(category);
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    const where = { userId: this.userId, category, month: m, year: y };
    try {
      await this.budgetModel.findOneAndUpdate(where, { limitAmount }, { upsert: true });
    } catch (err: any) {
      // Two saves of a new budget at once both try to insert; the unique index
      // refuses the second. The row exists now, so update it.
      if (err?.code !== 11000) throw err;
      await this.budgetModel.findOneAndUpdate(where, { limitAmount });
    }
  }
}
