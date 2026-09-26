import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * A bank mail from a known sender that no parser could read. It is retried on
 * every poll until it books (and its record is deleted) or the user dismisses
 * it as not a transaction (and it is skipped from then on).
 */
@Schema()
export class UnreadableMail extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) messageId: string;
  @Prop() sender: string;
  @Prop() subject: string;
  @Prop() receivedAt: Date;
  /** Gmail's own arrival time (IMAP internalDate); missing on rows saved before this field existed. */
  @Prop() arrivedAt?: Date;
  @Prop() firstSeenAt: Date;
  @Prop() lastSeenAt: Date;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: false }) dismissed: boolean;
  /** Why it's listed, when that isn't simply that no parser could read it. */
  @Prop() reason?: string;
}

export const UnreadableMailSchema = SchemaFactory.createForClass(UnreadableMail);

UnreadableMailSchema.index({ userId: 1, messageId: 1 }, { unique: true });
