import { dailyClosings, windowStart } from './daily-closings';

const at = (iso: string) => new Date(iso);
const START = at('2026-09-20T04:00:00Z'); // local midnight, Sep 20

describe('dailyClosings', () => {
  it('carries the previous closing forward over days with no movement', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 5,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-21T15:00:00Z'), newBalance: 900 },
        { timestamp: at('2026-09-23T15:00:00Z'), newBalance: 1200 },
      ],
    });
    expect(points).toEqual([
      { day: '2026-09-20', balance: 1000 },
      { day: '2026-09-21', balance: 900 },
      { day: '2026-09-22', balance: 900 },
      { day: '2026-09-23', balance: 1200 },
      { day: '2026-09-24', balance: 1200 },
    ]);
  });

  it('takes the last row of each day', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 2,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-21T13:00:00Z'), newBalance: 900 },
        { timestamp: at('2026-09-21T20:00:00Z'), newBalance: 850 },
      ],
    });
    expect(points[1]).toEqual({ day: '2026-09-21', balance: 850 });
  });

  it('counts 03:59 UTC on the previous local day and 04:00 UTC on its own', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 4,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-22T03:59:00Z'), newBalance: 700 },
        { timestamp: at('2026-09-23T04:00:00Z'), newBalance: 600 },
      ],
    });
    expect(points).toEqual([
      { day: '2026-09-20', balance: 1000 },
      { day: '2026-09-21', balance: 700 },
      { day: '2026-09-22', balance: 700 },
      { day: '2026-09-23', balance: 600 },
    ]);
  });

  it('is a flat line at the opening when there are no rows', () => {
    expect(dailyClosings({ windowStart: START, days: 3, opening: 1000, rows: [] }).map((p) => p.balance)).toEqual([
      1000, 1000, 1000,
    ]);
  });
});

describe('windowStart', () => {
  it('is local midnight days − 1 days before today, whatever the UTC date', () => {
    // 02:00Z Sep 25 is still Sep 24 in Santo Domingo.
    expect(windowStart(at('2026-09-25T02:00:00Z'), 90)).toEqual(at('2026-06-27T04:00:00Z'));
    expect(windowStart(at('2026-09-24T04:00:00Z'), 1)).toEqual(at('2026-09-24T04:00:00Z'));
  });
});
