import { isoWeekKey, latestPeriods, ReportPeriod } from './report-periods';

const at = (iso: string) => new Date(iso);
const weekly = (now: Date) => latestPeriods(now).find((p) => p.kind === 'weekly') as ReportPeriod;
const monthly = (now: Date) => latestPeriods(now).find((p) => p.kind === 'monthly') as ReportPeriod;

describe('latestPeriods', () => {
  it('keeps the previous digest until 11:00 UTC (07:00 Santo Domingo) on Monday', () => {
    const p = weekly(at('2026-09-28T10:59:00Z'));
    expect(p.dueAt).toEqual(at('2026-09-21T11:00:00Z'));
    expect(p.key).toBe('2026-W38');
  });

  it('from 11:00 UTC on Monday covers the week just ended, local midnight to local midnight', () => {
    expect(weekly(at('2026-09-28T11:00:00Z'))).toEqual({
      kind: 'weekly',
      key: '2026-W39',
      from: at('2026-09-21T04:00:00Z'),
      to: at('2026-09-28T04:00:00Z'),
      dueAt: at('2026-09-28T11:00:00Z'),
      expired: false,
    });
  });

  it('keys weeks by ISO week-year across New Year', () => {
    expect(isoWeekKey(at('2025-12-29T04:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(at('2026-12-28T04:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(at('2027-01-04T04:00:00Z'))).toBe('2027-W01');
    expect(weekly(at('2027-01-04T11:00:00Z')).key).toBe('2026-W53');
  });

  it('from 11:00 UTC on the 1st summarises the month just ended, across a year too', () => {
    expect(monthly(at('2027-01-01T11:00:00Z'))).toEqual({
      kind: 'monthly',
      key: '2026-12',
      from: at('2026-12-01T00:00:00Z'),
      to: at('2027-01-01T00:00:00Z'),
      dueAt: at('2027-01-01T11:00:00Z'),
      expired: false,
    });
  });

  it('before 11:00 UTC on the 1st the latest summary is still the previous one', () => {
    const p = monthly(at('2027-01-01T10:59:00Z'));
    expect(p.key).toBe('2026-11');
    expect(p.dueAt).toEqual(at('2026-12-01T11:00:00Z'));
  });

  it('keeps a digest sendable for exactly 3 days, then expires it', () => {
    // Due Mon Sep 28 11:00Z.
    expect(weekly(at('2026-10-01T11:00:00Z')).expired).toBe(false);
    expect(weekly(at('2026-10-01T11:01:00Z')).expired).toBe(true);
  });

  it('keeps a summary sendable for exactly 7 days, then expires it', () => {
    // Due Thu Oct 1 11:00Z.
    expect(monthly(at('2026-10-08T11:00:00Z')).expired).toBe(false);
    expect(monthly(at('2026-10-08T11:01:00Z')).expired).toBe(true);
  });
});
