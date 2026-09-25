export interface BalanceSummary {
  balance: number;
  isPremium: boolean;
  lastActivity: string;
  language: string;
}

export interface Transaction {
  _id: string;
  transactionName: string;
  transactionType: string;
  amount: number;
  isExpense: boolean;
  timestamp: string;
  category: string;
  categoryNeedsReview?: boolean;
  merchant?: string;
  source?: string;
  transferKind?: string;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface BudgetEntry {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  percentage: number;
  month: number;
  year: number;
}

export interface MonthlySummary {
  month: number;
  year: number;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
}

export interface MonthlyPoint {
  label: string;
  income: number;
  expense: number;
}

export interface CategoryPoint {
  category: string;
  total: number;
}

export interface RecurringEntry {
  id: string;
  transactionName: string;
  isIncome: boolean;
  amount: number;
  category: string;
  dayOfMonth: number;
  lastExecutedAt?: string | null;
}

export interface Tip {
  title: string;
  description: string;
  category: string;
  icon: string;
  priority: 'high' | 'medium' | 'low';
  potentialSaving?: string;
}

export interface PeriodSummary {
  month:          string;
  totalIncome:    number;
  totalExpenses:  number;
  net:            number;
  topCategories:  { category: string; amount: number }[];
}

export interface CompareResult {
  monthA:   PeriodSummary;
  monthB:   PeriodSummary;
  analysis: string;
}

export interface TopTransaction {
  rank:        number;
  name:        string;
  count:       number;
  totalAmount: number;
}

export interface ChartPoint {
  month: string;
  total: number;
}

export interface SetBudgetRequest {
  category: string;
  limitAmount: number;
  month?: number;
  year?: number;
}

export interface CategoryEntry {
  name:      string;
  color:     string;
  emoji:     string;
  isBuiltIn: boolean;
  id:        string | null;
}

export interface CreateTransactionRequest {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  timestamp?: string;
}

export interface UpdateTransactionRequest {
  name?: string;
  category?: string;
  amount?: number;
  timestamp?: string;
}

export interface CreateRecurringRequest {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  dayOfMonth: number;
}

export type BalanceChangeReason = 'income' | 'expense' | 'delete' | 'manual' | 'recurring';

export interface BalanceHistoryItem {
  id: string;
  timestamp: string;
  reason: BalanceChangeReason;
  delta: number;
  newBalance: number;
  name: string | null;
}

export interface BalanceHistoryPage {
  items: BalanceHistoryItem[];
  total: number;
}

export interface DailyBalance {
  day: string; // 'YYYY-MM-DD', Santo Domingo
  balance: number;
}

export interface SetBalanceResult {
  previousBalance: number;
  newBalance: number;
  delta: number;
}

export interface CategoryUsage {
  transactions: number;
  recurring: number;
  budgets: number;
  cashItems: number;
}

export interface CategoryOverviewItem {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
  isBuiltIn: boolean;
  active: boolean;
  usage: CategoryUsage;
  pending: { from: string; to: string } | null;
}

export interface CategoryOverview {
  categories: CategoryOverviewItem[];
  palette: { label: string; hex: string }[];
  emojis: string[];
}

export interface CategoryInput {
  name?: string;
  emoji?: string;
  color?: string;
}
