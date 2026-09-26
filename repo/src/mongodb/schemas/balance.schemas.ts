import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Balance extends Document {
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  balance: number;

  @Prop({ required: true, default: false })
  isBaned: boolean;

  @Prop({ required: true, default: false })
  isPremium: boolean;

  @Prop({ required: true, default: 0 })
  dayOfPremium: Date;

  @Prop({})
  startPayload: string;

  @Prop({ default: Date.now })
  lastActivity: Date;

  @Prop({ default: 'en' })
  language: string;

  /** Written only by the api: incremented by every ledger write, orders history rows exactly. */
  @Prop()
  seq?: number;
}

export const BalanceSchema = SchemaFactory.createForClass(Balance);
