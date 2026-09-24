import { periodKey } from '../ingestion/reconciliation.service';

/** How far back a missed occurrence is still booked automatically. */
export const LOOKBACK_DAYS = 31;

/** 08:00 America/Santo_Domingo — UTC−4 all year; the Dominican Republic has no DST. */
export const DUE_HOUR_UTC = 12;

const DAY_MS = 86_400_000;

export interface SchedulableRule {
  /** 1..28 (schema bound), so the day exists in every month. */
  dayOfMonth: number;
  /** From the rule's ObjectId — NOT the createdAt field, which loads as "now" on legacy rules. */
  createdAt: Date;
  /** Last month handled, 'YYYY-MM'. */
  lastPeriod?: string;
  lastExecutedAt?: Date;
}

export interface Occurrence {
  period: string;
  dueAt: Date;
}

/**
 * Which of a rule's monthly occurrences are due now, and which were missed so
 * long ago that they are skipped instead of booked. Pure: no clock, no database.
 *
 * "Handled through" is lastPeriod, or — for legacy rules the bot ran — the
 * month of lastExecutedAt: the bot always ran on the due day at 12:00 UTC, so
 * that month is the month of the occurrence it handled.
 */
export function planOccurrences(rule: SchedulableRule, now: Date): { due: Occurrence[]; tooOld: Occurrence[] } {
  const due: Occurrence[] = [];
  const tooOld: Occurrence[] = [];

  const handled =
    rule.lastPeriod ?? (rule.lastExecutedAt ? periodKey(new Date(rule.lastExecutedAt)) : undefined);

  // Months are counted as year * 12 + zero-based month, so month arithmetic
  // can never loop on an un-normalised month number across a year boundary.
  let first: number;
  if (handled) {
    const [y, m] = handled.split('-').map(Number);
    first = y * 12 + m; // m is 1-based: as a zero-based index it is already the month after
  } else {
    first = rule.createdAt.getUTCFullYear() * 12 + rule.createdAt.getUTCMonth();
  }
  const last = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const windowStart = now.getTime() - LOOKBACK_DAYS * DAY_MS;

  for (let index = first; index <= last; index++) {
    const dueAt = new Date(Date.UTC(Math.floor(index / 12), index % 12, rule.dayOfMonth, DUE_HOUR_UTC));
    if (dueAt.getTime() > now.getTime()) continue; // not yet due
    if (dueAt.getTime() < rule.createdAt.getTime()) continue; // before the rule existed

    // periodKey reads local time. Noon UTC on day 1–28 falls in the same calendar
    // month in every zone from UTC−12 to UTC+14, so the key never depends on
    // where the process runs.
    const occurrence = { period: periodKey(dueAt), dueAt };
    if (dueAt.getTime() < windowStart) tooOld.push(occurrence);
    else due.push(occurrence);
  }

  return { due, tooOld };
}

/**
 * A stored rule as planOccurrences needs it. The creation time comes from the
 * ObjectId, NOT the createdAt field: Mongoose fills a missing createdAt with
 * "now" when it loads a legacy rule, which would hide every occurrence.
 */
export function schedulableFrom(rule: {
  _id: unknown;
  dayOfMonth: number;
  lastPeriod?: string;
  lastExecutedAt?: Date;
}): SchedulableRule {
  return {
    dayOfMonth: rule.dayOfMonth,
    createdAt: (rule._id as { getTimestamp(): Date }).getTimestamp(),
    lastPeriod: rule.lastPeriod,
    lastExecutedAt: rule.lastExecutedAt,
  };
}
