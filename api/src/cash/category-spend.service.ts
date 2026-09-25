import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { CategoryTotal, rollUpByCategory } from './category-rollup';

/**
 * The one answer to "how much went to each category" between two instants.
 * Every per-category view asks here, so cash itemization reaches all of them
 * the same way: budgets, statistics, the emails, compare and tips.
 */
@Injectable()
export class CategorySpendService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
  ) {}

  /** Spending per category from `from` (inclusive) to `to` (exclusive), largest first. */
  async byCategory(from: Date, to: Date): Promise<CategoryTotal[]> {
    const txs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: from, $lt: to }, amount: { $lt: 0 }, ...SPENDING_ONLY })
      .select('amount category isWithdrawal')
      .lean();
    const rows = txs.map((t) => ({ id: String(t._id), amount: t.amount, category: t.category, isWithdrawal: t.isWithdrawal }));

    // Items of deleted or non-spending withdrawals never load: only this period's live spending rows are asked for.
    const withdrawalIds = rows.filter((r) => r.isWithdrawal).map((r) => r.id);
    const items = withdrawalIds.length
      ? await this.itemModel
          .find({ userId: this.userId, withdrawalId: { $in: withdrawalIds } })
          .select('withdrawalId amount category')
          .lean()
      : [];

    return rollUpByCategory(rows, items);
  }
}
