export interface CategoryTotal {
  category: string;
  total: number;
}

export interface ExpenseLine {
  name: string;
  at: Date;
  /** Positive magnitude. */
  amount: number;
}

export interface BudgetLine {
  category: string;
  limit: number;
  spent: number;
}

export interface RecurringProblem {
  name: string;
  dueAt: Date;
}

export interface Health {
  overdueRecurring: RecurringProblem[];
  /** When the newest bank email was ingested; null if none ever was. */
  lastIngestedAt: Date | null;
  /** Whole days since lastIngestedAt; null when nothing was ingested. */
  daysSinceIngest: number | null;
  /** Nothing ingested, or the newest is older than the threshold. */
  ingestionStale: boolean;
}

export interface WeeklyReportData {
  /** Covered week [from, to). */
  from: Date;
  to: Date;
  week: { spent: number; income: number; topCategories: CategoryTotal[]; largest: ExpenseLine[] };
  /** The month of the send time, so far. `monthNumber` is 1..12; the render names it. */
  month: { monthNumber: number; spent: number; income: number; net: number; budgets: BudgetLine[] };
  waiting: { unresolved: number; toReview: number };
  health: Health;
}

export interface MonthlyReportData {
  month: number; // 1..12
  year: number;
  income: number;
  expense: number;
  net: number;
  /** Expenses of the month before; 0 omits the change. */
  previousExpense: number;
  categories: CategoryTotal[];
  budgets: BudgetLine[];
}
