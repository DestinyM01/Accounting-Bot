import { Types } from 'mongoose';
import { afterTime, encodeTimeCursor, parseTimeCursor } from './cursor';

const ID = '64b0000000000000000000a1';
const T = new Date('2026-09-20T15:00:00.000Z');

describe('time cursor', () => {
  it('round-trips a timestamp and an id', () => {
    const raw = encodeTimeCursor(T, ID);
    expect(raw).toBe(`2026-09-20T15:00:00.000Z_${ID}`);
    const c = parseTimeCursor(raw)!;
    expect(c.t.toISOString()).toBe(T.toISOString());
    expect(String(c.id)).toBe(ID);
  });

  it.each([['empty', ''], ['no id', '2026-09-20T15:00:00.000Z'], ['bad date', `nope_${ID}`], ['bad id', '2026-09-20T15:00:00.000Z_nope']])(
    'rejects a malformed cursor (%s)',
    (_label, raw) => expect(parseTimeCursor(raw)).toBeNull(),
  );

  it('asks for the rows after the cursor in (timestamp desc, _id desc) order', () => {
    const c = parseTimeCursor(encodeTimeCursor(T, ID))!;
    expect(afterTime(c)).toEqual({
      $or: [{ timestamp: { $lt: T } }, { timestamp: T, _id: { $lt: new Types.ObjectId(ID) } }],
    });
  });
});
