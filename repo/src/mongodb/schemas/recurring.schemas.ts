import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from '../../type/enum/transactionType.enam';
import { Category } from '../../type/enum/category.enum';

@Schema()
export class Recurring extends Document {
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

  @Prop({ enum: Category, default: Category.OTHER })
  category: Category;

  @Prop({ required: true, min: 1, max: 28 })
  dayOfMonth: number;

  @Prop({ required: true, default: true })
  active: boolean;

  @Prop({ required: true, default: Date.now })
  createdAt: Date;

  @Prop()
  lastExecutedAt: Date;
}

export const RecurringSchema = SchemaFactory.createForClass(Recurring);
