import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { isNonSpendingTransfer } from '../shared/schemas/transfer-kind';

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

/** The calendar month a scheduled occurrence belongs to, as 'YYYY-MM'. */
export function periodKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The period whose scheduled occurrence `tx` satisfies, or null when none does.
 *
 * Checks the rule's target date in the previous, current AND next month, so a
 * payment posted just before or after a month boundary still reconciles against
 * the occurrence it actually belongs to. Pure day-number arithmetic cannot do
 * this: a payment on the 31st against a rule for the 1st is 30 apart by
 * subtraction but one day apart in reality.
 *
 * Amounts must be EXACTLY equal in absolute value. These are fixed monthly
 * payments, so a tolerance would buy nothing and would let a genuinely
 * different payment of a similar size be swallowed as a duplicate.
 */
export function matchedPeriod(rule: RuleLike, tx: TxLike): string | null {
  if (!rule.active) return null;
  if (rule.userId !== tx.userId) return null;
  if (Math.abs(rule.amount) !== Math.abs(tx.amount)) return null;

  // An internal transfer moves no money and an unresolved one has not been
  // asserted, so neither can be the real-world payment a rule predicts.
  // Without this, an internal funding leg of the same amount consumes the rule
  // and the genuine expense is never recorded at all.
  if (isNonSpendingTransfer(tx.transferKind)) return null;

  // The schema constrains transactionType, but TypeScript doesn't — RuleLike
  // types it as a plain string and the caller passes `r as any`. Comparing
  // only against EXPENSE would treat any other value, including an absent or
  // unexpected one, as income. Fail closed instead: an unknown type matches
  // nothing.
  const ruleIsExpense = rule.transactionType === TransactionType.EXPENSE;
  const ruleIsIncome = rule.transactionType === TransactionType.INCOME;
  if (!ruleIsExpense && !ruleIsIncome) return null;

  // Expenses are stored negative, income positive. A rule predicting an expense
  // must not be satisfied by income of the same magnitude.
  const txIsExpense = tx.amount < 0;
  if (txIsExpense !== ruleIsExpense) return null;

  const y = tx.timestamp.getFullYear();
  const m = tx.timestamp.getMonth();
  const txDay = new Date(y, m, tx.timestamp.getDate());

  let best: { key: string; diff: number } | null = null;
  for (const offset of [-1, 0, 1]) {
    const first = new Date(y, m + offset, 1);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const target = new Date(
      first.getFullYear(),
      first.getMonth(),
      Math.min(rule.dayOfMonth, daysInMonth),
    );
    const diff = Math.abs(Math.round((txDay.getTime() - target.getTime()) / 86400000));
    if (diff <= MATCH_WINDOW_DAYS && (!best || diff < best.diff)) {
      best = { key: periodKey(target), diff };
    }
  }
  return best ? best.key : null;
}

/** True when `tx` is the real-world payment that `rule` predicts. */
export function matchesRule(rule: RuleLike, tx: TxLike): boolean {
  return matchedPeriod(rule, tx) !== null;
}
