/**
 * Santo Domingo wall-clock time without relying on the process time zone.
 * The Dominican Republic is UTC−4 all year (no daylight saving time), so a
 * fixed offset is exact. Use these wherever a time must be the user's local
 * time however the server is configured: bank-mail times, report and
 * recurring schedules, daily balance closings.
 */
export const SANTO_DOMINGO_OFFSET_HOURS = 4;
const OFFSET_MS = SANTO_DOMINGO_OFFSET_HOURS * 3_600_000;

/** The instant a Santo Domingo wall-clock time happens. `monthIndex` is 0-based, like Date's. */
export function santoDomingoInstant(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour + SANTO_DOMINGO_OFFSET_HOURS, minute, second));
}

/** `d` shifted so its UTC getters read the Santo Domingo calendar and clock. Never store or compare it as an instant. */
export function santoDomingoWallClock(d: Date): Date {
  return new Date(d.getTime() - OFFSET_MS);
}

/** 'YYYY-MM-DD' of the Santo Domingo calendar day containing `d`. */
export function santoDomingoDateKey(d: Date): string {
  return santoDomingoWallClock(d).toISOString().slice(0, 10);
}
