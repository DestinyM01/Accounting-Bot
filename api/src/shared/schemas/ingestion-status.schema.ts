import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** How the last ingestion run went, for the Settings page. One document per user. */
@Schema()
export class IngestionStatus extends Document {
  @Prop({ required: true }) userId: number;
  /** When the last run finished, and its counts. */
  @Prop() lastRunAt?: Date;
  @Prop() created?: number;
  @Prop() alreadyBooked?: number;
  @Prop() notTransactions?: number;
  @Prop() unreadable?: number;
  @Prop() bookingFailed?: number;
  /** Mails in the last run whose sender Gmail couldn't vouch for (see mail-auth.ts). Not one of the five counts. */
  @Prop() unverified?: number;
  /** Where the next run starts reading (never before INGEST_START_AT). Moves only after a run that finished. */
  @Prop() resumeFrom?: Date;
  /**
   * The configured start (ISO, or null when none) resumeFrom was computed
   * under. Lets windowStart() tell a stale point — recorded under a start
   * that has since changed — apart from one still valid under today's start,
   * so lowering INGEST_START_AT re-reads from it instead of being shadowed
   * by a point that already sits past it.
   */
  @Prop({ type: String, default: null }) resumeStartAt?: string | null;
  /** The last run that failed as a whole (e.g. IMAP login refused); null again after a successful run. */
  @Prop({ type: String, default: null }) lastError?: string | null;
  @Prop() lastErrorAt?: Date;
}

export const IngestionStatusSchema = SchemaFactory.createForClass(IngestionStatus);

IngestionStatusSchema.index({ userId: 1 }, { unique: true });
