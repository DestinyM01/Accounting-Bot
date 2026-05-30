import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class CustomCategory extends Document {
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  name: string; // lowercase, e.g. "gym"

  @Prop({ required: true })
  emoji: string; // e.g. "💪"

  @Prop({ required: true })
  color: string; // hex e.g. "#3b82f6"

  @Prop({ default: true })
  active: boolean;
}

export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
