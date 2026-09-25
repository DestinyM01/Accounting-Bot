import { SANTO_DOMINGO_OFFSET_HOURS, santoDomingoDateKey, santoDomingoInstant, santoDomingoWallClock } from './santo-domingo';

describe('santo-domingo', () => {
  it('is UTC−4 all year', () => {
    expect(SANTO_DOMINGO_OFFSET_HOURS).toBe(4);
  });

  it('turns a Santo Domingo wall-clock time into its instant', () => {
    expect(santoDomingoInstant(2026, 8, 18, 15, 11).toISOString()).toBe('2026-09-18T19:11:00.000Z');
    expect(santoDomingoInstant(2026, 8, 21, 12, 32, 21).toISOString()).toBe('2026-09-21T16:32:21.000Z');
  });

  it('puts local midnight at 04:00 UTC, and rolls past a year end', () => {
    expect(santoDomingoInstant(2026, 8, 18).toISOString()).toBe('2026-09-18T04:00:00.000Z');
    expect(santoDomingoInstant(2026, 11, 31, 23, 30).toISOString()).toBe('2027-01-01T03:30:00.000Z');
  });

  it('reads the local calendar day of an instant', () => {
    expect(santoDomingoDateKey(new Date('2026-09-18T03:59:59.999Z'))).toBe('2026-09-17');
    expect(santoDomingoDateKey(new Date('2026-09-18T04:00:00.000Z'))).toBe('2026-09-18');
  });

  it('gives the local clock through the UTC getters', () => {
    const l = santoDomingoWallClock(new Date('2026-09-18T19:11:00Z'));
    expect([l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), l.getUTCHours(), l.getUTCMinutes()]).toEqual([2026, 8, 18, 15, 11]);
  });
});
