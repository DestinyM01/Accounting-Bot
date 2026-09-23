/** Days either side of a rule's dayOfMonth that still count as the same payment. */
export const MATCH_WINDOW_DAYS = 3;

export interface RuleLike {
  _id: unknown;
  userId: number;
  amount: number;
  dayOfMonth: number;
  active: boolean;
}

export interface TxLike {
  userId: number;
  amount: number;
  timestamp: Date;
}

/**
 * True when `tx` is the real-world payment that `rule` predicts.
 *
 * Amounts must be EXACTLY equal in absolute value. These are fixed monthly
 * payments, so a tolerance would buy nothing and would let a genuinely
 * different payment of a similar size be swallowed as a duplicate.
 */
export function matchesRule(rule: RuleLike, tx: TxLike): boolean {
  if (!rule.active) return false;
  if (rule.userId !== tx.userId) return false;
  if (Math.abs(rule.amount) !== Math.abs(tx.amount)) return false;

  const day = tx.timestamp.getDate();
  return Math.abs(day - rule.dayOfMonth) <= MATCH_WINDOW_DAYS;
}
