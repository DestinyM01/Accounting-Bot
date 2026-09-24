import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from '../../type/enum/transactionType.enam';
import { Category } from '../../type/enum/category.enum';
import { TransferKind } from '../../type/transfer-kind';

@Schema()
export class Transaction extends Document {
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  transactionName: string;

  @Prop({ required: true, enum: TransactionType })
  transactionType: TransactionType;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: Date.now })
  timestamp: Date;

  @Prop({ default: Category.OTHER })
  category: string;

  @Prop({ index: { unique: true, sparse: true } })
  sourceMessageId?: string;

  @Prop()
  source?: string;

  @Prop()
  categoryNeedsReview?: boolean;

  @Prop()
  merchant?: string;

  @Prop()
  cardLast4?: string;

  @Prop()
  originalAmount?: number;

  @Prop()
  originalCurrency?: string;

  @Prop()
  isWithdrawal?: boolean;

  @Prop()
  externalRef?: string;

  /** How this transfer relates to the user's own accounts. Absent for ordinary card transactions. */
  @Prop({ type: String })
  transferKind?: TransferKind;

  /** The other leg of an internal transfer reported by two banks. Set on both rows once reconciled. */
  @Prop()
  matchedLegId?: string;

  /** Soft-delete marker for every row. Never hard-delete: an email-sourced row must keep its sourceMessageId or the next poll re-creates it. */
  @Prop()
  deletedAt?: Date;

  @Prop()
  recurringId?: string;

  /** The scheduled occurrence this satisfies, as 'YYYY-MM'. Set with recurringId. */
  @Prop()
  recurringPeriod?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// One transaction per scheduled occurrence of a recurring rule. Mirrors
// api/src/shared/schemas/transaction.schema.ts — both services back the same
// collection. Partial: rows not linked to a rule are unaffected.
TransactionSchema.index(
  { userId: 1, recurringId: 1, recurringPeriod: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $exists: true } } },
);
