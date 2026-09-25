import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { NOT_DELETED, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { HALF_CENT, round2 } from './cash-rules';

/**
 * Repairs a withdrawal's itemized counter (Transaction.allocatedCash) left above
 * its items — by a crash between the reservation and the insert, or an ambiguous
 * insert error — by lowering it to the items' sum with a write guarded on the value
 * read. Used when that high counter blocks something: an itemize (CashService.add)
 * or an amount edit (TransactionsService.update).
 *
 * Known limit: an add from another tab that has reserved but not yet inserted, a
 * concurrent remove() whose decrement hasn't landed, or a pending release after a
 * refused insert, in the same milliseconds, can leave the counter below the items
 * by that amount, which would allow over-itemizing by it. One user; accepted.
 */
@Injectable()
export class CounterRepairService {
  private readonly logger = new Logger(CounterRepairService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
  ) {}

  /** True when it lowered the counter; false when there was nothing to repair or the guard missed. */
  async repair(withdrawalId: string): Promise<boolean> {
    const tx = await this.txModel.findOne({ _id: withdrawalId, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx || !tx.isWithdrawal || !(tx.amount < 0) || isNonSpendingTransfer(tx.transferKind)) return false;
    const items = await this.itemModel.find({ userId: this.userId, withdrawalId: String(tx._id) }).lean();
    const sum = round2(items.reduce((s, i) => s + i.amount, 0));
    const counter = tx.allocatedCash ?? 0;
    if (counter <= sum + HALF_CENT) return false;
    const res = await this.txModel.updateOne(
      { _id: tx._id, userId: this.userId, allocatedCash: tx.allocatedCash },
      { $set: { allocatedCash: sum } },
    );
    if (!res.modifiedCount) return false;
    this.logger.warn(`Withdrawal ${String(tx._id)}: itemized counter was ${round2(counter)} but its items sum to ${sum}; corrected`);
    return true;
  }
}
