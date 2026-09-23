import { parseDdMmYyyyDash12h } from './dates';

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
