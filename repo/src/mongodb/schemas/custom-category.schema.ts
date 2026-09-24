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

  /**
   * Mirror of api/src/shared/schemas/custom-category.schema.ts — same collection.
   * Written only by the api: an unfinished move of every reference from one
   * name to another; cleared when it completes.
   */
  @Prop({ type: Object, default: null })
  pending?: { from: string; to: string } | null;
}

export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
