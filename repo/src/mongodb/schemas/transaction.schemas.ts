import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TransactionType } from '../../type/enum/transactionType.enam';
import { Category } from '../../type/enum/category.enum';

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

  @Prop({ enum: Category, default: Category.OTHER })
  category: Category;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
