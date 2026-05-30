import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Category } from './category.enum';

@Schema()
export class Budget extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) category: string;
  @Prop({ required: true }) limitAmount: number;
  @Prop({ required: true }) month: number;
  @Prop({ required: true }) year: number;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);
