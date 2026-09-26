import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Budget extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) category: string;
  @Prop({ required: true }) limitAmount: number;
  @Prop({ required: true }) month: number;
  @Prop({ required: true }) year: number;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);

// One budget per category and month. Without it, two saves at once could each insert a row.
BudgetSchema.index({ userId: 1, category: 1, month: 1, year: 1 }, { unique: true });
