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
