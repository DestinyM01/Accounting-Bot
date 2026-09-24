import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../mongodb/schemas/recurring.schemas';
import { TransactionType } from '../type/enum/transactionType.enam';

/**
 * Recurring rules as the bot manages them. Booking moved to the api's hourly
 * sweep (api/src/recurring/recurring-scheduler.service.ts) on 2026-09-24; the
 * bot is scaled to zero and must never book on its own again.
 */
@Injectable()
export class RecurringService {
  constructor(@InjectModel('Recurring') private readonly recurringModel: Model<Recurring>) {}

  async createRecurring(
    userId: number,
    userName: string,
    transactionName: string,
    transactionType: TransactionType,
    amount: number,
    dayOfMonth: number,
    category: string = 'other',
  ): Promise<Recurring> {
    return this.recurringModel.create({
      userId,
      userName,
      transactionName,
      transactionType,
      amount,
      dayOfMonth,
      category,
      active: true,
    });
  }

  async listRecurring(userId: number): Promise<Recurring[]> {
    return this.recurringModel.find({ userId, active: true }).exec();
  }

  async deleteRecurring(userId: number, recurringId: string): Promise<void> {
    await this.recurringModel.findOneAndUpdate({ _id: recurringId, userId }, { active: false }).exec();
  }
}
