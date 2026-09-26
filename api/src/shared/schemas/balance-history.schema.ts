import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const BALANCE_CHANGE_REASONS = ['income', 'expense', 'delete', 'manual', 'recurring'] as const;
export type BalanceChangeReason = (typeof BALANCE_CHANGE_REASONS)[number];

@Schema()
export class BalanceHistory extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) previousBalance: number;
  @Prop({ required: true }) newBalance: number;
  @Prop({ required: true }) delta: number;
  @Prop({ required: true }) reason: BalanceChangeReason;
  @Prop() transactionName?: string;
  @Prop() transactionId?: string;
  @Prop({ required: true, default: Date.now }) timestamp: Date;
  /** Balance.seq after this change; absent on rows written before it existed. */
  @Prop() seq?: number;
}

export const BalanceHistorySchema = SchemaFactory.createForClass(BalanceHistory);

// The Balance page lists a user's history newest first and charts a window of it.
BalanceHistorySchema.index({ userId: 1, timestamp: -1 });
BalanceHistorySchema.index({ userId: 1, seq: -1 });
