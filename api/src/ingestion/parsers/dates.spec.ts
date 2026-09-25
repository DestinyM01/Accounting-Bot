import { parseDMyHms, parseDdMmYyyy, parseDdMmYyyy12h, parseDdMmYyyyDash12h, parseSpanishLongDate } from './dates';

describe('parseDdMmYyyyDash12h', () => {
  it('parses "28/08/2026 - 8:33 AM"', () => {
    const d = parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(28);
    expect(d!.getHours()).toBe(8);
    expect(d!.getMinutes()).toBe(33);
  });

  it('converts PM correctly', () => {
    expect(parseDdMmYyyyDash12h('24/08/2026 - 2:51 PM')!.getHours()).toBe(14);
  });

  it('treats 12:xx AM as midnight', () => {
    expect(parseDdMmYyyyDash12h('02/09/2026 - 12:15 AM')!.getHours()).toBe(0);
  });

  it('falls back to the date-only parse when no time is present', () => {
    expect(parseDdMmYyyyDash12h('28/08/2026')!.getDate()).toBe(28);
  });

  it('returns null for unparseable input', () => {
    expect(parseDdMmYyyyDash12h('not a date')).toBeNull();
  });
});

describe('bank times are read in the user zone', () => {
  it('stores a BHD "09:53 pm" as the true instant', () => {
    expect(parseDdMmYyyy12h('24/09/2026 09:53 pm')!.toISOString()).toBe('2026-09-25T01:53:00.000Z');
  });
});

// Bank mail states Santo Domingo wall-clock times. They must become the same
// instants however the server's zone is set: a lost TZ line in the Dockerfile
// must not shift every mail by hours.
describe('mail times in any server time zone', () => {
  const saved = process.env.TZ;
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it.each(['UTC', 'Asia/Tokyo', 'America/Santo_Domingo'])('reads Santo Domingo wall-clock times with TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(parseDdMmYyyy('11/09/2026')!.toISOString()).toBe('2026-09-11T04:00:00.000Z');
    expect(parseDdMmYyyy12h('18/09/2026 03:11 pm')!.toISOString()).toBe('2026-09-18T19:11:00.000Z');
    expect(parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM')!.toISOString()).toBe('2026-08-28T12:33:00.000Z');
    expect(parseDMyHms('21/9/2026 12:32:21')!.toISOString()).toBe('2026-09-21T16:32:21.000Z');
    expect(parseSpanishLongDate('18 de Septiembre 2026 - 11:52 AM')!.toISOString()).toBe('2026-09-18T15:52:00.000Z');
  });
});
