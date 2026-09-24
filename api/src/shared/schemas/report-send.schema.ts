import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * One record per emailed report (weekly digest or monthly summary), claimed
 * before sending. 'sending' is in progress (or abandoned, if old); 'sent' and
 * 'skipped' are final.
 */
@Schema()
export class ReportSend extends Document {
  /** 'weekly' | 'monthly' */
  @Prop({ required: true }) kind: string;
  /** The period key: 'YYYY-Www' or 'YYYY-MM'. */
  @Prop({ required: true }) period: string;
  /** 'sending' | 'sent' | 'skipped' */
  @Prop({ required: true }) status: string;
  /** When status was last set. */
  @Prop({ required: true }) at: Date;
}

export const ReportSendSchema = SchemaFactory.createForClass(ReportSend);

ReportSendSchema.index({ kind: 1, period: 1 }, { unique: true });
