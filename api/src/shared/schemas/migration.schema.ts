import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** A one-time data correction: its cut-off, and when it finished. */
@Schema()
export class Migration extends Document {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) cutoff: Date;
  @Prop() doneAt?: Date;
  @Prop() shifted?: number;
}

export const MigrationSchema = SchemaFactory.createForClass(Migration);

MigrationSchema.index({ name: 1 }, { unique: true });
