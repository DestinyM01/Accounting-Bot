import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** How the last ingestion run went, for the Settings page. One document per user. */
@Schema()
export class IngestionStatus extends Document {
  @Prop({ required: true }) userId: number;
  /** When the last run finished, and its counts. */
  @Prop() lastRunAt?: Date;
  @Prop() created?: number;
  @Prop() skipped?: number;
  @Prop() failed?: number;
  /** The last run that failed as a whole (e.g. IMAP login refused); null again after a successful run. */
  @Prop({ type: String, default: null }) lastError?: string | null;
  @Prop() lastErrorAt?: Date;
}

export const IngestionStatusSchema = SchemaFactory.createForClass(IngestionStatus);

IngestionStatusSchema.index({ userId: 1 }, { unique: true });
