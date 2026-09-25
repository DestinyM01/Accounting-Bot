/**
 * The api runs in the user's zone (ENV TZ=America/Santo_Domingo in the Dockerfile;
 * UTC−4 all year, no DST), so server-local months and days are the user's own.
 */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → 00:00:00.000 of that calendar day in the server's zone, or null when malformed. */
export function localDayStart(day: string): Date | null {
  const m = DAY.exec(day);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** 'YYYY-MM-DD' → 23:59:59.999 of that calendar day in the server's zone, or null when malformed. */
export function localDayEnd(day: string): Date | null {
  const m = DAY.exec(day);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : null;
}
