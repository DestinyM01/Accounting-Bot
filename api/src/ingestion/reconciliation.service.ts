import { TransactionType } from '../shared/schemas/transaction-type.enum';

/** Days either side of a rule's dayOfMonth that still count as the same payment. */
export const MATCH_WINDOW_DAYS = 3;

export interface RuleLike {
  _id: unknown;
  userId: number;
  amount: number;
  dayOfMonth: number;
  active: boolean;
  transactionType: string;
}

export interface TxLike {
  userId: number;
  amount: number;
  timestamp: Date;
  transferKind?: string;
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

  // An internal transfer moves no money and an unresolved one has not been
  // asserted, so neither can be the real-world payment a rule predicts.
  // Without this, an internal funding leg of the same amount consumes the rule
  // and the genuine expense is never recorded at all.
  if (tx.transferKind === 'internal' || tx.transferKind === 'unresolved') return false;

  // Expenses are stored negative, income positive. A rule predicting an expense
  // must not be satisfied by income of the same magnitude.
  const txIsExpense = tx.amount < 0;
  const ruleIsExpense = rule.transactionType === TransactionType.EXPENSE;
  if (txIsExpense !== ruleIsExpense) return false;

  const day = tx.timestamp.getDate();
  return Math.abs(day - rule.dayOfMonth) <= MATCH_WINDOW_DAYS;
}
