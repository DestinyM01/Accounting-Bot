import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { stringify } from 'csv-stringify/sync';
import { Transaction } from '../type/interface';

@Injectable()
export class ExportService {
  private readonly logger: Logger = new Logger(ExportService.name);

  constructor(@InjectModel('Transaction') private readonly transactionModel: Model<Transaction>) {}

  async exportUserTransactionsCsvByPeriod(
    userId: number,
    startDate: Date,
    endDate: Date,
    groupIds?: number[],
  ): Promise<Buffer> {
    // Internal transfers move money between the user's own accounts and
    // unresolved ones have not been asserted, so neither is spending — left
    // in, they'd print as ordinary expense rows in the CSV.
    const transferGuard = { transferKind: { $nin: ['internal', 'unresolved'] } };
    const query =
      groupIds && groupIds.length > 0
        ? { userId: { $in: [...groupIds, userId] }, timestamp: { $gte: startDate, $lte: endDate }, ...transferGuard }
        : { userId, timestamp: { $gte: startDate, $lte: endDate }, ...transferGuard };

    const transactions = await this.transactionModel.find(query).sort({ timestamp: -1 }).lean().exec();
    const rows = transactions.map((t) => ({
      date: new Date(t.timestamp).toISOString().slice(0, 10),
      name: t.transactionName,
      type: t.transactionType,
      category: t.category ?? 'other',
      amount: t.amount,
    }));
    const csv = stringify(rows, { header: true, columns: ['date', 'name', 'type', 'category', 'amount'] });
    this.logger.log(`Exported ${rows.length} transactions (period) for user ${userId}`);
    return Buffer.from(csv);
  }

  async exportUserTransactionsCsv(userId: number, groupIds?: number[]): Promise<Buffer> {
    // Internal transfers move money between the user's own accounts and
    // unresolved ones have not been asserted, so neither is spending — left
    // in, they'd print as ordinary expense rows in the CSV.
    const transferGuard = { transferKind: { $nin: ['internal', 'unresolved'] } };
    const query =
      groupIds && groupIds.length > 0
        ? { userId: { $in: [...groupIds, userId] }, ...transferGuard }
        : { userId, ...transferGuard };

    const transactions = await this.transactionModel.find(query).sort({ timestamp: -1 }).lean().exec();

    const rows = transactions.map((t) => ({
      date: new Date(t.timestamp).toISOString().slice(0, 10),
      name: t.transactionName,
      type: t.transactionType,
      category: t.category ?? 'other',
      amount: t.amount,
    }));

    const csv = stringify(rows, { header: true, columns: ['date', 'name', 'type', 'category', 'amount'] });
    this.logger.log(`Exported ${rows.length} transactions for user ${userId}`);
    return Buffer.from(csv);
  }
}
