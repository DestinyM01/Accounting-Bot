import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from './transaction-type.enum';
import { Category } from './category.enum';

@Schema()
export class Recurring extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) userName: string;
  @Prop({ required: true }) transactionName: string;
  @Prop({ required: true, enum: TransactionType }) transactionType: TransactionType;
  @Prop({ required: true }) amount: number;
  @Prop({ default: Category.OTHER }) category: string;
  /** 1..28, so the day exists in every month (the sweep relies on it). */
  @Prop({
    required: true,
    min: 1,
    max: 28,
    validate: { validator: Number.isInteger, message: 'dayOfMonth must be a whole number' },
  })
  dayOfMonth: number;
  @Prop({ required: true, default: true }) active: boolean;
  @Prop({ required: true, default: Date.now }) createdAt: Date;
  @Prop() lastExecutedAt: Date;

  /**
   * The last occurrence handled — booked, found already satisfied, or skipped
   * as too old — as 'YYYY-MM'. Only ever moves forward. Deleting a transaction
   * never touches it, so a deleted recurring row is never booked again.
   */
  @Prop() lastPeriod?: string;
}

export const RecurringSchema = SchemaFactory.createForClass(Recurring);
