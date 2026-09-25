import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from './transaction-type.enum';
import { Category } from './category.enum';
import { TransferKind } from './transfer-kind';

@Schema()
export class Transaction extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) userName: string;
  @Prop({ required: true }) transactionName: string;
  @Prop({ required: true, enum: TransactionType }) transactionType: TransactionType;
  // Expenses are stored as negative numbers. Always Math.abs() before display.
  @Prop({ required: true }) amount: number;
  @Prop({ required: true, default: Date.now }) timestamp: Date;
  @Prop({ default: Category.OTHER }) category: string;
  @Prop({ index: { unique: true, sparse: true } }) sourceMessageId?: string;
  @Prop() source?: string;
  @Prop() categoryNeedsReview?: boolean;
  @Prop() merchant?: string;
  @Prop() cardLast4?: string;
  @Prop() originalAmount?: number;
  @Prop() originalCurrency?: string;
  @Prop() isWithdrawal?: boolean;

  /**
   * Withdrawals only: the sum of this withdrawal's CashAllocation items. It is a
   * reservation counter that only guarded writes change (see CashService), and it
   * guards against itemizing more than was withdrawn. Totals read the items, never this.
   */
  @Prop() allocatedCash?: number;

  /**
   * This row's time was read in the user's zone. Set on every row the ingester writes;
   * rows read before the api ran in America/Santo_Domingo were 4 hours early until
   * MailTimeBackfillService corrected them and set this.
   */
  @Prop() mailTimeLocal?: boolean;
  @Prop() externalRef?: string;

  /** How this transfer relates to the user's own accounts. Absent for ordinary card transactions. */
  @Prop({ type: String }) transferKind?: TransferKind;

  /**
   * The other leg of an internal transfer reported by two banks (sent by one,
   * received by the other). Set on both rows once they are reconciled.
   */
  @Prop() matchedLegId?: string;

  /**
   * Soft-delete marker for every row. Never hard-delete a row once it has been
   * returned to a caller: an email-sourced row must keep its sourceMessageId
   * or the next poll re-creates it.
   */
  @Prop() deletedAt?: Date;

  /** The recurring rule this transaction satisfies, when reconciled. */
  @Prop() recurringId?: string;

  /** The scheduled occurrence this satisfies, as 'YYYY-MM'. Set with recurringId. */
  @Prop() recurringPeriod?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// One transaction per scheduled occurrence of a recurring rule. Both the
// ingestion side and the api's recurring sweep reconcile through this key;
// the database enforces it rather than two find-then-create sequences
// racing each other.
// Partial: rows not linked to a rule (a deliberately separate second payment
// of the same amount) are unaffected.
TransactionSchema.index(
  { userId: 1, recurringId: 1, recurringPeriod: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $exists: true } } },
);
