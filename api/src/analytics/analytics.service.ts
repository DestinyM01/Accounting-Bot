import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface TopTransaction {
  rank:        number;
  name:        string;
  count:       number;
  totalAmount: number;
}

export interface ChartPoint {
  month: string;
  total: number;
}

@Injectable()
export class AnalyticsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {}

  async getTop10(): Promise<TopTransaction[]> {
    const results = await this.txModel.aggregate([
      { $match: { userId: this.userId } },
      {
        $group: {
          _id:         '$transactionName',
          count:       { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return results.map((r, i) => ({
      rank:        i + 1,
      name:        r._id,
      count:       r.count,
      totalAmount: r.totalAmount,
    }));
  }

  async getTransactionChart(name: string): Promise<ChartPoint[]> {
    if (!name || name.length > 200) {
      return [];
    }
    const txs = await this.txModel
      .find({ userId: this.userId, transactionName: name })
      .select('timestamp amount')
      .lean();

    const monthMap: Record<string, number> = {};
    for (const t of txs) {
      const d   = new Date(t.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + Math.abs(t.amount);
    }

    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
  }
}
