/** 07:00 America/Santo_Domingo — UTC−4 all year; the Dominican Republic has no DST. */
export const DUE_HOUR_UTC = 11;
/** Local midnight in Santo Domingo. */
const LOCAL_MIDNIGHT_HOUR_UTC = 4;
export const WEEKLY_WINDOW_DAYS = 3;
export const MONTHLY_WINDOW_DAYS = 7;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type ReportKind = 'weekly' | 'monthly';

export interface ReportPeriod {
  kind: ReportKind;
  /** weekly: ISO week of the covered Monday, 'YYYY-Www'; monthly: the covered month, 'YYYY-MM'. */
  key: string;
  /** Covered range, inclusive. */
  from: Date;
  /** Covered range, exclusive. */
  to: Date;
  dueAt: Date;
  /** More than the kind's window has passed since dueAt: record it as skipped, never send it late. */
  expired: boolean;
}

/**
 * The latest weekly digest and the latest monthly summary whose due moment has
 * passed. Only the latest of each kind is ever considered; older ones are
 * neither sent nor recorded.
 */
export function latestPeriods(now: Date): ReportPeriod[] {
  return [latestWeekly(now), latestMonthly(now)];
}

function latestWeekly(now: Date): ReportPeriod {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  let dueAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, DUE_HOUR_UTC),
  );
  if (dueAt.getTime() > now.getTime()) dueAt = new Date(dueAt.getTime() - 7 * DAY_MS);

  const to = new Date(dueAt.getTime() - (DUE_HOUR_UTC - LOCAL_MIDNIGHT_HOUR_UTC) * HOUR_MS);
  const from = new Date(to.getTime() - 7 * DAY_MS);
  return {
    kind: 'weekly',
    key: isoWeekKey(from),
    from,
    to,
    dueAt,
    expired: now.getTime() - dueAt.getTime() > WEEKLY_WINDOW_DAYS * DAY_MS,
  };
}

function latestMonthly(now: Date): ReportPeriod {
  let dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, DUE_HOUR_UTC));
  if (dueAt.getTime() > now.getTime()) {
    dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, DUE_HOUR_UTC));
  }

  const from = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), 1));
  return {
    kind: 'monthly',
    key: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`,
    from,
    to,
    dueAt,
    expired: now.getTime() - dueAt.getTime() > MONTHLY_WINDOW_DAYS * DAY_MS,
  };
}

/**
 * ISO-8601 week of the date's UTC calendar day, as 'YYYY-Www'. The week-year
 * can differ from the calendar year: the Thursday of the week decides it.
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = d.getUTCDay() || 7; // Monday 1 … Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const weekYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(weekYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}
