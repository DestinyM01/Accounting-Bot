import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** The category the user last chose for a bank merchant (see MerchantMemoryService). */
@Schema()
export class MerchantCategory extends Document {
  @Prop({ required: true }) userId: number;
  /** merchantKey() of the bank's merchant name. */
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) category: string;
  @Prop() updatedAt: Date;
}

export const MerchantCategorySchema = SchemaFactory.createForClass(MerchantCategory);

MerchantCategorySchema.index({ userId: 1, key: 1 }, { unique: true });
