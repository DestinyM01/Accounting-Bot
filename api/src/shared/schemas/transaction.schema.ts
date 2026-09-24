import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from './transaction-type.enum';
import { Category } from './category.enum';

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
  @Prop() externalRef?: string;

  /** 'external' | 'internal' | 'unresolved'. Absent for ordinary card transactions. */
  @Prop() transferKind?: string;

  /**
   * The other leg of an internal transfer reported by two banks (sent by one,
   * received by the other). Set on both rows once they are reconciled.
   */
  @Prop() matchedLegId?: string;

  /** Soft-delete marker. Rows are never removed: an email-sourced row must keep its sourceMessageId. */
  @Prop() deletedAt?: Date;

  /** The recurring rule this transaction satisfies, when reconciled. */
  @Prop() recurringId?: string;

  /** The scheduled occurrence this satisfies, as 'YYYY-MM'. Set with recurringId. */
  @Prop() recurringPeriod?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// One transaction per scheduled occurrence of a recurring rule. Both the
// ingestion side and the bot's cron reconcile through this key; the database
// enforces it rather than two find-then-create sequences racing each other.
// Partial: rows not linked to a rule (a deliberately separate second payment
// of the same amount) are unaffected.
TransactionSchema.index(
  { userId: 1, recurringId: 1, recurringPeriod: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $exists: true } } },
);
