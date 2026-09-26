import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { CategoriesService } from '../categories/categories.service';

export interface CreateRecurringBody {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  dayOfMonth: number;
}

@Injectable()
export class RecurringService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Recurring.name) private model: Model<Recurring>,
    private readonly categories: CategoriesService,
  ) {}

  async create(body: CreateRecurringBody): Promise<{ id: string }> {
    // Express 5 leaves req.body undefined (not {}) when no body is sent;
    // fall back to {} so a bodyless POST still fails the checks below with
    // the same 400s an empty-object body always produced.
    const { type, amount, name, category, dayOfMonth } = body ?? ({} as CreateRecurringBody);
    if (type !== 'income' && type !== 'expense') throw new BadRequestException(`type must be income or expense (got ${type})`);
    if (typeof amount !== 'number' || !(amount > 0)) throw new BadRequestException(`amount must be > 0 (got ${amount})`);
    if (!name?.trim()) throw new BadRequestException('name is required');
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) throw new BadRequestException(`dayOfMonth must be an integer 1..28 (got ${dayOfMonth})`);
    await this.categories.assertValid(category);

    const doc = await this.model.create({
      userId: this.userId,
      userName: 'web',
      transactionName: name.trim().toLowerCase(),
      transactionType: type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: Math.abs(amount),          // the cron signs it by type when it fires
      dayOfMonth,
      category,
      active: true,
    });
    return { id: String(doc._id) };
  }

  async list() {
    const items = await this.model
      .find({ userId: this.userId, active: true })
      .sort({ dayOfMonth: 1 })
      .lean();

    return items.map((r) => ({
      id: (r as any)._id.toString(),
      transactionName: r.transactionName,
      isIncome: r.transactionType === TransactionType.INCOME,
      amount: r.amount,
      category: r.category,
      dayOfMonth: r.dayOfMonth,
      lastExecutedAt: r.lastExecutedAt ?? null,
      /** The month the scheduler last handled ('YYYY-MM'): the Recurring page's "billed this month". */
      lastPeriod: r.lastPeriod ?? null,
    }));
  }

  async delete(id: string): Promise<void> {
    await this.model.findOneAndUpdate(
      { _id: id, userId: this.userId },
      { active: false },
    );
  }
}
