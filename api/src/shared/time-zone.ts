/**
 * The api runs in the user's zone (ENV TZ=America/Santo_Domingo in the Dockerfile;
 * UTC−4 all year, no DST), so server-local months and days are the user's own.
 */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when a Date's local getters round-trip back to the parsed y/m/d — false for e.g. Feb 31. */
function isRealDay(d: Date, year: number, month: number, day: number): boolean {
  return d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
}

/** 'YYYY-MM-DD' → 00:00:00.000 of that calendar day in the server's zone, or null when malformed. */
export function localDayStart(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  return isRealDay(date, y, mo, d) ? date : null;
}

/** 'YYYY-MM-DD' → 23:59:59.999 of that calendar day in the server's zone, or null when malformed. */
export function localDayEnd(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return isRealDay(date, y, mo, d) ? date : null;
}

/** The calendar day of an instant in the server's zone (the user's). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/**
 * An instant from configuration. A date-time without a zone (e.g. "2026-09-24T14:58:59")
 * is read as UTC, as it was before the api ran in the user's zone; one with "Z" or an
 * offset is read as written. Returns null when it isn't a date.
 */
export function parseConfiguredInstant(raw: string | undefined): Date | null {
  const v = raw?.trim();
  if (!v) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = new Date(hasZone ? v : `${v}Z`);
  return isNaN(d.getTime()) ? null : d;
}
