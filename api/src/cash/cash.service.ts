import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types, mongo } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { Category } from '../shared/schemas/category.enum';
import { NOT_DELETED, SPENDING_ONLY, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { CategoriesService } from '../categories/categories.service';
import { HALF_CENT, money, round2 } from './cash-rules';

export interface CashItemInput {
  category?: unknown;
  amount?: unknown;
  description?: unknown;
}

export interface CashBreakdown {
  id: string;
  name: string;
  timestamp: Date;
  /** The withdrawal's amount, positive. */
  amount: number;
  allocated: number;
  remaining: number;
  items: { id: string; category: string; description: string | null; amount: number }[];
}

const MAX_AMOUNT = 1e12;
const MAX_DESCRIPTION = 60;

/**
 * Itemizes ATM withdrawals. Items carry category weight only. They never touch
 * Balance or BalanceHistory, because the withdrawal already moved the balance,
 * which is why this service has no ledger.
 *
 * Over-itemizing is prevented by a reservation counter on the withdrawal
 * (Transaction.allocatedCash) that only guarded writes change. Every total
 * reads the items themselves.
 */
@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
    private readonly categories: CategoriesService,
  ) {}

  /** A live withdrawal and its items, oldest first. What's allocated and left is computed from the items. */
  async breakdown(id: string): Promise<CashBreakdown> {
    const tx = await this.findLive(id);
    if (!this.itemizable(tx)) throw new NotFoundException('No such withdrawal');
    const items = await this.itemModel
      .find({ userId: this.userId, withdrawalId: String(tx._id) })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    const amount = Math.abs(tx.amount);
    const allocated = round2(items.reduce((s, i) => s + i.amount, 0));
    return {
      id: String(tx._id),
      name: tx.transactionName,
      timestamp: tx.timestamp,
      amount,
      allocated,
      remaining: round2(Math.max(0, amount - allocated)),
      items: items.map((i) => ({ id: String(i._id), category: i.category, description: i.description ?? null, amount: i.amount })),
    };
  }

  async add(withdrawalId: string, input: CashItemInput): Promise<{ id: string }> {
    const amount = this.parseAmount(input.amount);
    const description = this.parseDescription(input.description);
    const category = await this.parseCategory(input.category);
    if (!Types.ObjectId.isValid(withdrawalId)) throw new NotFoundException('No such withdrawal');

    // Reserve first, in one guarded write. The counter only grows while it stays
    // within the withdrawal, so two concurrent adds can't both fit into the same remainder.
    let reserved = await this.reserve(withdrawalId, amount);
    // A refusal can come from a counter left high by an earlier failure: repair it once and retry.
    if (!reserved && (await this.repairCounter(withdrawalId))) reserved = await this.reserve(withdrawalId, amount);
    if (!reserved) throw await this.whyNotReserved(withdrawalId);

    // The id is chosen here so it's ready to return as soon as create succeeds;
    // it no longer exists to be looked up if create throws.
    const itemId = new Types.ObjectId();
    try {
      await this.itemModel.create({
        _id: itemId,
        userId: this.userId,
        withdrawalId: String(reserved._id),
        category,
        amount,
        ...(description ? { description } : {}),
      });
      return { id: String(itemId) };
    } catch (err) {
      await this.releaseIfRefused(err, reserved._id, amount);
      throw err;
    }
  }

  /** The guarded reservation: grows the counter by `amount` only while it stays within the withdrawal. */
  private reserve(withdrawalId: string, amount: number) {
    return this.txModel.findOneAndUpdate(
      {
        _id: withdrawalId,
        userId: this.userId,
        isWithdrawal: true,
        amount: { $lt: 0 },
        ...SPENDING_ONLY,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ['$allocatedCash', 0] }, amount] },
            { $add: [{ $abs: '$amount' }, HALF_CENT] },
          ],
        },
      },
      { $inc: { allocatedCash: amount } },
      { new: true },
    );
  }

  /**
   * Lowers a counter left above its items (a crash between the reservation and the
   * insert, or an ambiguous insert error) to the items' sum, with a write guarded on
   * the value read. Returns true when it corrected one. Known limit: an add from
   * another tab that has reserved but not yet inserted, in the same milliseconds,
   * would be undercounted by its amount.
   */
  private async repairCounter(withdrawalId: string): Promise<boolean> {
    const tx = await this.txModel.findOne({ _id: withdrawalId, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx || !this.itemizable(tx)) return false;
    const items = await this.itemModel.find({ userId: this.userId, withdrawalId: String(tx._id) }).lean();
    const sum = round2(items.reduce((s, i) => s + i.amount, 0));
    const counter = tx.allocatedCash ?? 0;
    if (counter <= sum + HALF_CENT) return false;
    const res = await this.txModel.updateOne(
      { _id: tx._id, userId: this.userId, allocatedCash: tx.allocatedCash },
      { $set: { allocatedCash: sum } },
    );
    if (!res.modifiedCount) return false;
    this.logger.warn(`Withdrawal ${String(tx._id)}: itemized counter was ${counter} but its items sum to ${sum}; corrected`);
    return true;
  }

  /**
   * Hands a reservation back only when the database definitely refused the item:
   * a validation or cast error, or a server-side rejection. Anything else, such as
   * a dropped connection or a timeout, may hide a write that landed, so the counter
   * stays high: that blocks some itemizing but never allows too much.
   */
  private async releaseIfRefused(err: unknown, withdrawalId: unknown, amount: number): Promise<void> {
    const refused =
      err instanceof MongooseError.ValidationError ||
      err instanceof MongooseError.CastError ||
      (err instanceof mongo.MongoServerError && !(err instanceof mongo.MongoWriteConcernError));
    if (!refused) {
      this.logger.error(
        `The item write on withdrawal ${String(withdrawalId)} may have landed; its counter stays high`,
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }
    try {
      await this.txModel.updateOne({ _id: withdrawalId }, { $inc: { allocatedCash: -amount } });
    } catch (e) {
      this.logger.error(
        `Could not release ${amount} on withdrawal ${String(withdrawalId)}; its counter stays high`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  async remove(itemId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException('No such item');
    // Delete first, then shrink the counter. A failure between the two leaves the
    // counter high (fail-safe), never low.
    const item = await this.itemModel.findOneAndDelete({ _id: itemId, userId: this.userId }).lean();
    if (!item) throw new NotFoundException('No such item');
    try {
      await this.txModel.updateOne({ _id: item.withdrawalId, userId: this.userId }, { $inc: { allocatedCash: -item.amount } });
    } catch (err) {
      this.logger.error(
        `Item ${itemId} was deleted but withdrawal ${item.withdrawalId} still counts its ${item.amount}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async findLive(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such withdrawal');
    const tx = await this.txModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx) throw new NotFoundException('No such withdrawal');
    return tx;
  }

  /** A spending withdrawal: the only kind of row that takes items. */
  private itemizable(tx: { isWithdrawal?: boolean; amount: number; transferKind?: string }): boolean {
    return !!tx.isWithdrawal && tx.amount < 0 && !isNonSpendingTransfer(tx.transferKind);
  }

  /** The reservation missed: find out why. This runs only on the failure path. */
  private async whyNotReserved(id: string): Promise<Error> {
    try {
      const tx = await this.findLive(id);
      if (!this.itemizable(tx)) return new BadRequestException('Only a cash withdrawal can be itemized');
      const left = round2(Math.max(0, Math.abs(tx.amount) - (tx.allocatedCash ?? 0)));
      return new BadRequestException(`Only ${money(left)} is left to itemize`);
    } catch (err) {
      return err as Error;
    }
  }

  private parseAmount(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new BadRequestException('amount must be a number');
    const amount = round2(raw);
    if (!(amount > 0)) throw new BadRequestException('amount must be greater than 0');
    if (amount > MAX_AMOUNT) throw new BadRequestException('amount is too large');
    return amount;
  }

  private parseDescription(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') throw new BadRequestException('description must be text');
    const text = raw.trim();
    if (text.length > MAX_DESCRIPTION) throw new BadRequestException(`description must be ${MAX_DESCRIPTION} characters or fewer`);
    return text || undefined;
  }

  private async parseCategory(raw: unknown): Promise<string> {
    if (typeof raw !== 'string' || !raw) throw new BadRequestException('category is required');
    if (raw === Category.CASH) throw new BadRequestException("Cash is what's left unitemized — pick where it went");
    await this.categories.assertValid(raw);
    return raw;
  }
}
