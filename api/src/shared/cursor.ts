import { Types } from 'mongoose';

/** A position in a list sorted by (timestamp desc, _id desc): the last row a page showed. */
export interface TimeCursor {
  t: Date;
  id: Types.ObjectId;
}

export function encodeTimeCursor(timestamp: Date, id: unknown): string {
  return `${new Date(timestamp).toISOString()}_${String(id)}`;
}

/** The cursor, or null when it's malformed (the caller answers 400). */
export function parseTimeCursor(raw: string): TimeCursor | null {
  const cut = raw.lastIndexOf('_');
  if (cut <= 0) return null;
  const t = new Date(raw.slice(0, cut));
  const id = raw.slice(cut + 1);
  if (isNaN(t.getTime()) || !/^[0-9a-f]{24}$/i.test(id)) return null;
  return { t, id: new Types.ObjectId(id) };
}

/** The filter for the rows after `c` in (timestamp desc, _id desc) order. */
export function afterTime(c: TimeCursor) {
  return { $or: [{ timestamp: { $lt: c.t } }, { timestamp: c.t, _id: { $lt: c.id } }] };
}
