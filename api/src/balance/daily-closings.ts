import { santoDomingoDateKey, santoDomingoInstant, santoDomingoWallClock } from '../shared/santo-domingo';

const DAY_MS = 86_400_000;

export interface ClosingRow {
  timestamp: Date;
  newBalance: number;
}

export interface DailyPoint {
  day: string; // 'YYYY-MM-DD', Santo Domingo
  balance: number;
}

/** 'YYYY-MM-DD' of the Santo Domingo calendar day containing the instant. */
export function localDay(d: Date): string {
  return santoDomingoDateKey(d);
}

/** Local midnight of the first day of a `days`-day window ending today (Santo Domingo). */
export function windowStart(now: Date, days: number): Date {
  const local = santoDomingoWallClock(now);
  return santoDomingoInstant(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (days - 1));
}

/**
 * One closing balance per local day, oldest first: the newBalance of the
 * day's last row, else the previous day's closing, starting from `opening`.
 * `rows` must be ascending and all at or after `windowStart`.
 */
export function dailyClosings(input: {
  windowStart: Date;
  days: number;
  opening: number;
  rows: ClosingRow[];
}): DailyPoint[] {
  const lastOfDay = new Map<string, number>();
  for (const row of input.rows) lastOfDay.set(localDay(row.timestamp), row.newBalance); // later rows overwrite

  const points: DailyPoint[] = [];
  let balance = input.opening;
  for (let i = 0; i < input.days; i++) {
    const day = localDay(new Date(input.windowStart.getTime() + i * DAY_MS));
    if (lastOfDay.has(day)) balance = lastOfDay.get(day);
    points.push({ day, balance });
  }
  return points;
}
