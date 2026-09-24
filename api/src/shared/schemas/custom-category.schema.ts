import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class CustomCategory extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) name:   string;
  @Prop({ required: true }) emoji:  string;
  @Prop({ required: true }) color:  string;
  @Prop({ default: true })  active: boolean;
  /** An unfinished move of every reference from one name to another; cleared when it completes. */
  @Prop({ type: Object, default: null }) pending?: { from: string; to: string } | null;
}

export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
