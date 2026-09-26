import { Types } from 'mongoose';
import { isSchedulableDay, planOccurrences, schedulableFrom, SchedulableRule } from './due-occurrences';

const at = (iso: string) => new Date(iso);

/** Unless a case says otherwise, the rule was created 2026-01-01. */
const rule = (overrides: Partial<SchedulableRule> = {}): SchedulableRule => ({
  dayOfMonth: 20,
  createdAt: at('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('planOccurrences', () => {
  it('books the occurrence missed in the Sep 2026 outage (legacy rule last run by the bot)', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 20, lastExecutedAt: at('2026-08-20T12:00:05Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.due).toEqual([{ period: '2026-09', dueAt: at('2026-09-20T12:00:00Z') }]);
    expect(plan.tooOld).toEqual([]);
  });

  it('is due from 12:00 UTC (08:00 Santo Domingo) on its day, not before', () => {
    const r = rule({ dayOfMonth: 25, lastPeriod: '2026-08' });
    expect(planOccurrences(r, at('2026-09-25T11:30:00Z')).due).toEqual([]);
    expect(planOccurrences(r, at('2026-09-25T12:30:00Z')).due).toEqual([
      { period: '2026-09', dueAt: at('2026-09-25T12:00:00Z') },
    ]);
  });

  it('catches up across a month end', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 28, lastPeriod: '2026-08' }), at('2026-10-02T09:00:00Z'));
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
    expect(plan.tooOld).toEqual([]);
  });

  it('skips, rather than books, occurrences older than 31 days', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 10, lastPeriod: '2026-06' }), at('2026-09-25T15:00:00Z'));
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-07', '2026-08']);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
  });

  it('never books an occurrence due before the rule was created', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 24, createdAt: at('2026-09-24T15:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan).toEqual({ due: [], tooOld: [] });
  });

  it('books nothing for a month already handled', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 20, lastPeriod: '2026-09' }), at('2026-09-25T15:00:00Z'));
    expect(plan).toEqual({ due: [], tooOld: [] });
  });

  it('lets lastPeriod win over lastExecutedAt', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 20, lastPeriod: '2026-09', lastExecutedAt: at('2026-08-20T12:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.due).toEqual([]);
  });

  it('bounds a never-run rule by its creation month and the window', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 5, createdAt: at('2026-07-01T00:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-07', '2026-08']);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
  });

  it('crosses a year boundary', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 15, lastPeriod: '2026-12' }), at('2027-01-20T00:00:00Z'));
    expect(plan.due).toEqual([{ period: '2027-01', dueAt: at('2027-01-15T12:00:00Z') }]);
  });

  it('includes both window edges: exactly 31 days back and exactly now', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 26, lastPeriod: '2026-07' }), at('2026-09-26T12:00:00Z'));
    expect(plan.due.map((o) => o.period)).toEqual(['2026-08', '2026-09']);
    expect(plan.tooOld).toEqual([]);
  });
});

describe('schedulableFrom', () => {
  it('takes the creation time from the ObjectId, never the createdAt field', () => {
    const _id = Types.ObjectId.createFromTime(Date.UTC(2026, 0, 1) / 1000);
    // What Mongoose loads for a legacy rule stored without createdAt: "now".
    const loaded = { _id, dayOfMonth: 20, lastPeriod: '2026-08', createdAt: new Date('2026-09-25T15:00:00Z') };
    expect(schedulableFrom(loaded)).toEqual({
      dayOfMonth: 20,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastPeriod: '2026-08',
      lastExecutedAt: undefined,
    });
  });
});

describe('planOccurrences and a failed month', () => {
  const NOW = new Date('2026-09-25T15:00:00Z');
  const createdAt = new Date('2026-01-01T00:00:00Z');

  it('keeps retrying the failed month after it drifts past the 31-day window', () => {
    // Aug 20 is 36 days old: normally too old, but it's the month that failed.
    const plan = planOccurrences({ dayOfMonth: 20, createdAt, lastPeriod: '2026-07', failedPeriod: '2026-08' }, NOW);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-08', '2026-09']);
    expect(plan.tooOld).toEqual([]);
  });

  it('still skips old months that never failed', () => {
    const plan = planOccurrences({ dayOfMonth: 20, createdAt, lastPeriod: '2026-07' }, NOW);
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-08']);
  });
});

describe('isSchedulableDay', () => {
  it.each([1, 15, 28])('accepts %i', (day) => expect(isSchedulableDay(day)).toBe(true));
  it.each([0, 29, 31, 1.5, NaN, '5', undefined])('rejects %p', (day) => expect(isSchedulableDay(day)).toBe(false));
});
