import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';

@Injectable()
export class RecurringService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(@InjectModel(Recurring.name) private model: Model<Recurring>) {}

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
    }));
  }

  async delete(id: string): Promise<void> {
    await this.model.findOneAndUpdate(
      { _id: id, userId: this.userId },
      { active: false },
    );
  }
}
