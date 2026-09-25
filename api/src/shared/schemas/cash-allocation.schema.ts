import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * One line of an itemized ATM withdrawal: how much of its cash went to which
 * category. It carries category weight only. The withdrawal (a Transaction)
 * keeps the total and already moved the balance.
 *
 * `amount` is a POSITIVE magnitude, unlike Transaction.amount, which stores
 * expenses as negative numbers.
 */
@Schema()
export class CashAllocation extends Document {
  @Prop({ required: true }) userId: number;
  /** The withdrawal's Transaction._id, as a string. */
  @Prop({ required: true }) withdrawalId: string;
  @Prop({ required: true }) category: string;
  @Prop({ required: true }) amount: number;
  @Prop() description?: string;
  @Prop({ required: true, default: Date.now }) createdAt: Date;
}

export const CashAllocationSchema = SchemaFactory.createForClass(CashAllocation);

CashAllocationSchema.index({ userId: 1, withdrawalId: 1 });
