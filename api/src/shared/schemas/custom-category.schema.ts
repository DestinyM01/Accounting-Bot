import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class CustomCategory extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) name:   string;
  @Prop({ required: true }) emoji:  string;
  @Prop({ required: true }) color:  string;
  @Prop({ default: true })  active: boolean;
}

export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
