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
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
