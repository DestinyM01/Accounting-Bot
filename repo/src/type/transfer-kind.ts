/**
 * How a transaction relates to the user's own accounts.
 *   external   — money left to / arrived from a third party; spending or income
 *   internal   — moved between the user's own cash accounts; never spending
 *   unresolved — could not be determined; recorded, never asserted
 * Absent means an ordinary card transaction, which always counts.
 */
export type TransferKind = 'external' | 'internal' | 'unresolved';

export const NON_SPENDING_KINDS = ['internal', 'unresolved'] as const;

export function isNonSpendingTransfer(kind?: string | null): boolean {
  return !!kind && (NON_SPENDING_KINDS as readonly string[]).includes(kind);
}

/**
 * Spread into EVERY query on the transactions collection. In Mongo,
 * `deletedAt: null` matches documents where the field is null OR absent, so
 * every row written before soft-delete existed still qualifies.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/**
 * Spread into every query that sums, averages, counts or groups money.
 * `$nin` matches an absent field, so ordinary card transactions keep counting.
 */
export const SPENDING_ONLY = {
  ...NOT_DELETED,
  transferKind: { $nin: [...NON_SPENDING_KINDS] },
} as const;
