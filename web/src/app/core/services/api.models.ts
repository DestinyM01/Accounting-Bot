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
  isWithdrawal?: boolean;
  allocatedCash?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface CashItem {
  id: string;
  category: string;
  description: string | null;
  amount: number;
}

/** A withdrawal and what its cash went to. Amounts are positive. */
export interface CashBreakdown {
  id: string;
  name: string;
  timestamp: string;
  amount: number;
  allocated: number;
  remaining: number;
  items: CashItem[];
}

export interface CashItemInput {
  category: string;
  amount: number;
  description?: string;
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

// ── Settings ────────────────────────────────────────────────────────────
export type SettingSource = 'saved' | 'config';

export interface SettingValue<T> {
  value: T;
  source: SettingSource;
}

export interface LastSent {
  period: string;
  at: string;
}

export interface SettingsView {
  reports: {
    weekly: SettingValue<boolean>;
    monthly: SettingValue<boolean>;
    recipient: SettingValue<string | null>;
    lastSent: { weekly: LastSent | null; monthly: LastSent | null };
  };
  accounts: { cash: SettingValue<string[]>; senders: SettingValue<string[]> };
}

export interface ReportsSettingsInput {
  weekly: boolean;
  monthly: boolean;
  recipient: string | null;
}

export interface AccountsSettingsInput {
  cash: string[];
  senders: string[];
}

export interface RunCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface UnreadableMailItem {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  attempts: number;
  lastSeenAt: string;
}

export interface MailBookedItem {
  id: string;
  name: string;
  amount: number;
  isExpense: boolean;
  category: string;
  timestamp: string;
  transferKind: string | null;
}

export interface IngestionStatusView {
  startAt: string | null;
  running: boolean;
  lastRun: (RunCounts & { at: string }) | null;
  lastError: { at: string; message: string } | null;
  unreadable: UnreadableMailItem[];
  recent: MailBookedItem[];
}

// ── Growth calculator ──────────────────────────────────────────────────
export interface GrowthInput {
  start: number;
  monthly: number;
  rate: number;
  years: number;
}

export interface GrowthYear {
  year: number;
  balance: number;
  putIn: number;
  interest: number;
}

export interface GrowthResult {
  finalBalance: number;
  putIn: number;
  interest: number;
  years: GrowthYear[];
}

export interface MyNumbers {
  startingAmount: number;
  monthlySavings: number;
  spentMore: boolean;
  months: { month: number; year: number; income: number; expense: number; net: number }[];
}
