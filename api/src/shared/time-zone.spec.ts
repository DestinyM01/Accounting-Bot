import { localDayEnd, localDayStart, serverTimeZone } from './time-zone';

// Every test runs in the user's zone (jest.timezone.js), the same as the api image.
describe('the server time zone', () => {
  it('is America/Santo_Domingo in tests, as in production', () => {
    expect(serverTimeZone()).toBe('America/Santo_Domingo');
    expect(new Date(2026, 0, 1).toISOString()).toBe('2026-01-01T04:00:00.000Z');
  });

  it("reads a YYYY-MM-DD as that calendar day in the user's zone, start and end inclusive", () => {
    expect(localDayStart('2026-09-01').toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(localDayEnd('2026-09-30').toISOString()).toBe('2026-10-01T03:59:59.999Z');
  });

  it.each(['2026-9-1', 'sept', '', '2026-09-01T00:00'])('returns null for the malformed day %p', (day) => {
    expect(localDayStart(day)).toBeNull();
    expect(localDayEnd(day)).toBeNull();
  });
});
