import { localDateKey, localDayEnd, localDayStart, parseConfiguredInstant, serverTimeZone } from './time-zone';

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

  it.each(['2026-9-1', 'sept', '', '2026-09-01T00:00', '2026-02-31', '2026-13-01'])(
    'returns null for the malformed day %p',
    (day) => {
      expect(localDayStart(day)).toBeNull();
      expect(localDayEnd(day)).toBeNull();
    },
  );
});

describe('localDateKey', () => {
  it('reads the calendar day in the user zone, not UTC', () => {
    expect(localDateKey(new Date('2026-09-25T01:53:00Z'))).toBe('2026-09-24');
    expect(localDateKey(new Date('2026-09-25T04:00:00Z'))).toBe('2026-09-25');
  });
});

describe('parseConfiguredInstant', () => {
  it('reads a zone-less date-time as UTC, as it was before the api ran in the user zone', () => {
    expect(parseConfiguredInstant('2026-09-24T14:58:59')?.toISOString()).toBe('2026-09-24T14:58:59.000Z');
  });

  it('reads a date-time with Z as written', () => {
    expect(parseConfiguredInstant('2026-09-24T14:58:59Z')?.toISOString()).toBe('2026-09-24T14:58:59.000Z');
  });

  it('reads a date-time with an explicit offset as written', () => {
    expect(parseConfiguredInstant('2026-09-24T10:58:59-04:00')?.toISOString()).toBe('2026-09-24T14:58:59.000Z');
  });

  it('returns null for text that is not a date, and for undefined', () => {
    expect(parseConfiguredInstant('nope')).toBeNull();
    expect(parseConfiguredInstant(undefined)).toBeNull();
  });
});
