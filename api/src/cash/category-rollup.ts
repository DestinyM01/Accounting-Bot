import { round2 } from './cash-rules';

/** A spending row: a Transaction with amount < 0 (expenses are stored negative). */
export interface SpendRow {
  id: string;
  amount: number;
  category?: string | null;
  isWithdrawal?: boolean;
}

/** One itemized line of a withdrawal. `amount` is a POSITIVE magnitude, unlike SpendRow.amount. */
export interface ItemRow {
  withdrawalId: string;
  amount: number;
  category: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

/**
 * Spending per category with cash itemization applied:
 * - a withdrawal's own category gets |amount| minus the sum of its items (never below 0);
 * - each item's category gets the item's amount;
 * - every other row counts in full.
 * The totals therefore still add up to the rows' total spending.
 */
export function rollUpByCategory(rows: SpendRow[], items: ItemRow[]): CategoryTotal[] {
  const withdrawals = new Set(rows.filter((r) => r.isWithdrawal).map((r) => r.id));
  const itemized = new Map<string, number>();
  const totals = new Map<string, number>();
  const add = (category: string, amount: number) => totals.set(category, (totals.get(category) ?? 0) + amount);

  for (const it of items) {
    if (!withdrawals.has(it.withdrawalId)) continue; // its withdrawal is deleted, outside the period, or not spending
    itemized.set(it.withdrawalId, (itemized.get(it.withdrawalId) ?? 0) + it.amount);
    add(it.category, it.amount);
  }
  for (const row of rows) {
    const spent = Math.abs(row.amount);
    add(row.category || 'other', row.isWithdrawal ? Math.max(0, spent - (itemized.get(row.id) ?? 0)) : spent);
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total: round2(total) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}
