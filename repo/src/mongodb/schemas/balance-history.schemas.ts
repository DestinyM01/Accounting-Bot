import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BalanceChangeReason = 'income' | 'expense' | 'delete' | 'manual' | 'recurring';

@Schema()
export class BalanceHistory extends Document {
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  previousBalance: number;

  @Prop({ required: true })
  newBalance: number;

  @Prop({ required: true })
  delta: number;

  @Prop({ required: true })
  reason: BalanceChangeReason;

  @Prop()
  transactionName?: string;

  @Prop()
  transactionId?: string;

  @Prop({ required: true, default: Date.now })
  timestamp: Date;
}

export const BalanceHistorySchema = SchemaFactory.createForClass(BalanceHistory);
