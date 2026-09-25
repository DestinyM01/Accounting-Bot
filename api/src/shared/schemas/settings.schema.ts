import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * What the user saved on the Settings page. Every field is optional: absent
 * means "use the server's environment variable" (see SettingsService). Each
 * section is replaced whole when saved.
 */
@Schema()
export class Settings extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ type: Object, default: undefined }) reports?: { weekly?: boolean; monthly?: boolean; recipient?: string | null };
  @Prop({ type: Object, default: undefined }) accounts?: { cash?: string[]; senders?: string[] };
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);

SettingsSchema.index({ userId: 1 }, { unique: true });
