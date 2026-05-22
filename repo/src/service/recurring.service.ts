import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { Recurring } from '../mongodb/shemas/recurring.shemas';
import { TransactionService } from './transaction.service';
import { BalanceService } from './balance.service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { Category } from '../type/enum/category.enum';

@Injectable()
export class RecurringService {
  private readonly logger: Logger = new Logger(RecurringService.name);

  constructor(
    @InjectModel('Recurring') private readonly recurringModel: Model<Recurring>,
    private readonly transactionService: TransactionService,
    private readonly balanceService: BalanceService,
  ) {}

  async createRecurring(
    userId: number,
    userName: string,
    transactionName: string,
    transactionType: TransactionType,
    amount: number,
    dayOfMonth: number,
    category: Category = Category.OTHER,
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

  @Cron('0 8 * * *', { timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo' })
  async processRecurring(): Promise<void> {
    const today = new Date().getDate();
    this.logger.log(`Processing recurring transactions for day ${today}`);

    const due = await this.recurringModel.find({ dayOfMonth: today, active: true }).exec();
    for (const r of due) {
      try {
        const created = await this.transactionService.createTransaction({
          userId: r.userId,
          userName: r.userName,
          transactionName: r.transactionName,
          transactionType: r.transactionType,
          amount: r.amount,
          category: r.category,
        });
        await this.balanceService.updateBalance(
          r.userId,
          r.amount,
          r.transactionType,
          r.transactionName,
          (created as any)._id?.toString(),
        );
        r.lastExecutedAt = new Date();
        await r.save();
        this.logger.log(`Processed recurring "${r.transactionName}" for user ${r.userId}`);
      } catch (err) {
        this.logger.error(`Failed to process recurring ${r._id}`, err);
      }
    }
  }
}
