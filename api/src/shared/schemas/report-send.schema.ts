import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReportSendKind = 'weekly' | 'monthly';
/** 'sending' is a claim in progress; 'sent' and 'skipped' are final. */
export type ReportSendStatus = 'sending' | 'sent' | 'skipped';

/**
 * One record per emailed report (weekly digest or monthly summary), claimed
 * before sending. 'sending' is in progress (or abandoned, if old); 'sent' and
 * 'skipped' are final.
 */
@Schema()
export class ReportSend extends Document {
  @Prop({ required: true, type: String }) kind: ReportSendKind;
  /** The period key: 'YYYY-Www' or 'YYYY-MM'. */
  @Prop({ required: true }) period: string;
  @Prop({ required: true, type: String }) status: ReportSendStatus;
  /** When status was last set. */
  @Prop({ required: true }) at: Date;
}

export const ReportSendSchema = SchemaFactory.createForClass(ReportSend);

ReportSendSchema.index({ kind: 1, period: 1 }, { unique: true });
