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
  @Prop({ enum: Category, default: Category.OTHER }) category: Category;
  @Prop({ required: true }) dayOfMonth: number;
  @Prop({ required: true, default: true }) active: boolean;
  @Prop() lastExecutedAt: Date;
}

export const RecurringSchema = SchemaFactory.createForClass(Recurring);
