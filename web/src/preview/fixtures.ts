/**
 * In-memory sample data for the `preview` build. One Store instance backs
 * every /api endpoint the app calls (see preview-api.interceptor.ts): about
 * 60 transactions over the last three months, a balance that moves with
 * them, budgets, recurring rules, categories, merchants, settings, an
 * ingestion status and a few tips. Writes (create, edit, delete, category
 * assignment, cash itemizing...) mutate this same store, so the preview
 * behaves like a real, if tiny, dataset.
 *
 * Nothing here is real: the repo is public. Merchant names are generic
 * placeholders, the email is owner@example.com, and there are no account
 * numbers.
 */
import {
  AccountsSettingsInput,
  BalanceChangeReason,
  BalanceHistoryItem,
  BudgetEntry,
  CashItem,
  CategoryEntry,
  CategoryInput,
  CategoryOverviewItem,
  ChartPoint,
  CompareResult,
  CreateRecurringRequest,
  CreateTransactionRequest,
  DailyBalance,
  GrowthInput,
  GrowthResult,
  IngestionStatusView,
  MailBookedItem,
  MerchantMatch,
  MonthlyPoint,
  MonthlySummary,
  MyNumbers,
  PeriodSummary,
  RecurringEntry,
  RememberedMerchant,
  ReportsSettingsInput,
  RunCounts,
  SettingsView,
  Tip,
  TopTransaction,
  Transaction,
  UnreadableMailItem,
  UpdateTransactionRequest,
} from '../app/core/services/api.models';

// ── Deterministic randomness ────────────────────────────────────────────
// A seeded PRNG, so the sample data (and its screenshots) look the same on
// every build instead of reshuffling every time someone runs `ng serve`.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260927);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
/** A non-round money amount in [min, max]. */
const money = (min: number, max: number): number => Math.round((min + rng() * (max - min)) * 100) / 100;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Categories ───────────────────────────────────────────────────────────
const BUILT_IN_CATEGORIES: { name: string; color: string; emoji: string }[] = [
  { name: 'food', color: '#3fb68b', emoji: '🍽️' },
  { name: 'transport', color: '#e08a4a', emoji: '🚗' },
  { name: 'housing', color: '#4aa3d8', emoji: '🏠' },
  { name: 'health', color: '#9b86e0', emoji: '🩺' },
  { name: 'entertainment', color: '#d777a8', emoji: '🎬' },
  { name: 'salary', color: '#3fb68b', emoji: '💵' },
  { name: 'savings', color: '#52b788', emoji: '🐷' },
  { name: 'other', color: '#8b95a3', emoji: '📎' },
  { name: 'cash', color: '#8fb339', emoji: '🏧' },
];
interface CustomCategorySeed { id: string; name: string; color: string; emoji: string }
const CUSTOM_CATEGORIES: CustomCategorySeed[] = [
  { id: 'cat-freelance', name: 'freelance', color: '#5eb8ff', emoji: '💼' },
  { id: 'cat-gifts', name: 'gifts', color: '#ffb020', emoji: '🎁' },
  { id: 'cat-pets', name: 'pets', color: '#8dd3c7', emoji: '🐾' },
];
const PALETTE: { label: string; hex: string }[] = [
  { label: 'Amber', hex: '#f0b34a' },
  { label: 'Sky', hex: '#5eb8ff' },
  { label: 'Mint', hex: '#3fb68b' },
  { label: 'Rose', hex: '#d777a8' },
  { label: 'Violet', hex: '#9b86e0' },
  { label: 'Lime', hex: '#8fb339' },
  { label: 'Slate', hex: '#8b95a3' },
  { label: 'Coral', hex: '#e08a4a' },
];
const EMOJIS = ['💼', '🎁', '🐾', '🎓', '🛠️', '🎮', '📚', '✈️', '🏋️', '🎵', '🧾', '🌱'];

// ── Merchants ────────────────────────────────────────────────────────────
/** Name -> category, for the 8 remembered merchants the plan calls for. */
const KNOWN_MERCHANTS: { name: string; category: string }[] = [
  { name: 'Supermercado Central', category: 'food' },
  { name: 'Farmacia Norte', category: 'health' },
  { name: 'Gasolinera Este', category: 'transport' },
  { name: 'Cafe Plaza', category: 'food' },
  { name: 'Cine Metro', category: 'entertainment' },
  { name: 'Luz y Energia', category: 'housing' },
  { name: 'Internet Hogar', category: 'housing' },
  { name: 'Streaming Plus', category: 'entertainment' },
];
/** Merchants that show up with categoryNeedsReview, deliberately not remembered. */
const REVIEW_MERCHANTS: { name: string; guess: string }[] = [
  { name: 'Tienda El Sol', guess: 'other' },
  { name: 'Restaurante La Terraza', guess: 'food' },
  { name: 'Ferreteria Dominicana', guess: 'other' },
  { name: 'Clinica San Rafael', guess: 'health' },
];

/** Same grouping rule the app itself uses (see transactions.component.ts's filedNote). */
function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .split(/[\s*#]+/)
    .filter((t) => t && !/\d/.test(t))
    .join(' ')
    .trim();
}

// ── Date helpers ─────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n: number, hour = 12, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleString('en', { month: 'short' });
}
/** 'YYYY-MM' -> 'August 2026', for prose (table headers keep the raw key). */
function fullMonthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
}
let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${idCounter++}`;
}

// ── The store ────────────────────────────────────────────────────────────
interface BudgetLimit { category: string; month: number; year: number; limit: number }
interface Withdrawal { txId: string; items: CashItem[] }

class PreviewStore {
  transactions: Transaction[] = [];
  balanceHistory: BalanceHistoryItem[] = [];
  balance = 0;
  isPremium = false;
  language = 'en';

  budgetLimits: BudgetLimit[] = [];
  recurring: RecurringEntry[] = [];
  categories: (CategoryEntry & { active: boolean; pending: { from: string; to: string } | null })[] = [];
  merchants: RememberedMerchant[] = [];
  withdrawals: Withdrawal[] = [];
  tips: Tip[] = [];

  settings: SettingsView = {
    reports: {
      weekly: { value: true, source: 'config' },
      monthly: { value: true, source: 'config' },
      recipient: { value: null, source: 'config' },
      lastSent: {
        weekly: { period: monthKey(daysAgo(6)), at: daysAgo(6).toISOString() },
        monthly: { period: monthKey(daysAgo(30)), at: daysAgo(30).toISOString() },
      },
    },
    accounts: {
      cash: { value: ['2001'], source: 'saved' },
      senders: { value: ['alertas@bank.example'], source: 'config' },
    },
  };

  ingestion: IngestionStatusView = {
    startAt: daysAgo(90).toISOString(),
    readingFrom: daysAgo(1, 6, 0).toISOString(),
    running: false,
    lastRun: null,
    lastError: null,
    unreadable: [],
    recent: [],
  };

  constructor() {
    this.seedCategories();
    this.seedTransactions();
    this.seedMerchants();
    this.seedBudgets();
    this.seedRecurring();
    this.seedTips();
    this.seedIngestion();
  }

  // ── Seeding ──────────────────────────────────────────────────────────
  private seedCategories() {
    this.categories = [
      ...BUILT_IN_CATEGORIES.map((c) => ({ ...c, isBuiltIn: true, id: null, active: true, pending: null })),
      ...CUSTOM_CATEGORIES.map((c) => ({ ...c, isBuiltIn: false, id: c.id, active: true, pending: null })),
    ];
  }

  private seedTransactions() {
    const INITIAL_BALANCE = 18500;
    const items: Transaction[] = [];

    // Salary on the 25th: the 3 most recent occurrences at or before today.
    for (let back = 0; back < 3; back++) {
      const d = new Date();
      d.setDate(25);
      d.setMonth(d.getMonth() - back);
      d.setHours(9, 15, 0, 0);
      if (d.getTime() > Date.now()) { d.setMonth(d.getMonth() - 1); }
      items.push({
        _id: nextId('tx'),
        transactionName: 'Salary deposit',
        transactionType: 'deposit',
        amount: money(48000, 58000),
        isExpense: false,
        timestamp: d.toISOString(),
        category: 'salary',
        source: 'mail',
      });
    }

    // One freelance payment (custom category), income.
    items.push({
      _id: nextId('tx'),
      transactionName: 'Freelance payment',
      transactionType: 'deposit',
      amount: money(8000, 22000),
      isExpense: false,
      timestamp: daysAgo(Math.floor(rng() * 60) + 5, 11, 0).toISOString(),
      category: 'freelance',
      source: 'mail',
    });

    // One unresolved transfer, per the plan.
    items.push({
      _id: nextId('tx'),
      transactionName: 'Transfer sent',
      transactionType: 'transfer',
      amount: money(6000, 14000),
      isExpense: true,
      timestamp: daysAgo(12, 17, 30).toISOString(),
      category: 'other',
      transferKind: 'unresolved',
      source: 'mail',
    });

    // One cash withdrawal, itemized later via the withdrawals map.
    const withdrawalId = nextId('tx');
    items.push({
      _id: withdrawalId,
      transactionName: 'ATM withdrawal',
      transactionType: 'withdrawal',
      amount: 7000,
      isExpense: true,
      timestamp: daysAgo(9, 13, 45).toISOString(),
      category: 'cash',
      isWithdrawal: true,
      allocatedCash: 0,
      source: 'mail',
    });
    this.withdrawals.push({
      txId: withdrawalId,
      items: [
        { id: nextId('cash'), category: 'food', description: 'Market stall groceries', amount: 2200 },
        { id: nextId('cash'), category: 'transport', description: 'Parking and tolls', amount: 950 },
      ],
    });

    // A handful of rows still needing category review.
    for (const rm of REVIEW_MERCHANTS) {
      items.push({
        _id: nextId('tx'),
        transactionName: rm.name,
        transactionType: 'purchase',
        amount: money(300, 3500),
        isExpense: true,
        timestamp: daysAgo(Math.floor(rng() * 85) + 1, 10 + Math.floor(rng() * 9), Math.floor(rng() * 60)).toISOString(),
        category: rm.guess,
        categoryNeedsReview: true,
        merchant: merchantKey(rm.name),
        source: 'mail',
      });
    }

    // The bulk of the data: everyday transactions against the known merchants,
    // plus a few gifts/pets purchases and a couple of savings transfers.
    const AMOUNT_RANGES: Record<string, [number, number]> = {
      food: [250, 4200],
      transport: [180, 3500],
      housing: [900, 3800],
      entertainment: [300, 2200],
      health: [300, 6500],
    };
    const remaining = 60 - items.length;
    for (let i = 0; i < remaining; i++) {
      const roll = rng();
      const day = Math.floor(rng() * 89);
      const hour = 8 + Math.floor(rng() * 13);
      const minute = Math.floor(rng() * 60);
      const timestamp = daysAgo(day, hour, minute).toISOString();

      if (roll < 0.72) {
        const m = pick(KNOWN_MERCHANTS);
        const [min, max] = AMOUNT_RANGES[m.category] ?? [200, 3000];
        items.push({
          _id: nextId('tx'),
          transactionName: m.name,
          transactionType: 'purchase',
          amount: money(min, max),
          isExpense: true,
          timestamp,
          category: m.category,
          merchant: merchantKey(m.name),
          source: 'mail',
        });
      } else if (roll < 0.83) {
        const isGift = rng() < 0.5;
        items.push({
          _id: nextId('tx'),
          transactionName: isGift ? 'Gift shop' : 'Pet supply store',
          transactionType: 'purchase',
          amount: money(400, isGift ? 4500 : 3200),
          isExpense: true,
          timestamp,
          category: isGift ? 'gifts' : 'pets',
          source: 'mail',
        });
      } else if (roll < 0.93) {
        items.push({
          _id: nextId('tx'),
          transactionName: 'Transfer to savings',
          transactionType: 'transfer',
          amount: money(2000, 9000),
          isExpense: true,
          timestamp,
          category: 'savings',
          transferKind: 'internal',
          source: 'mail',
        });
      } else {
        items.push({
          _id: nextId('tx'),
          transactionName: 'Reimbursement received',
          transactionType: 'deposit',
          amount: money(500, 4000),
          isExpense: false,
          timestamp,
          category: 'other',
          source: 'mail',
        });
      }
    }

    // Apply oldest-to-newest, so the running balance and its history line up.
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let running = INITIAL_BALANCE;
    for (const tx of items) {
      const delta = tx.isExpense ? -tx.amount : tx.amount;
      running = Math.round((running + delta) * 100) / 100;
      this.balanceHistory.push({
        id: nextId('bh'),
        timestamp: tx.timestamp,
        reason: tx.isExpense ? 'expense' : 'income',
        delta,
        newBalance: running,
        name: tx.transactionName,
      });
    }
    this.balance = running;
    // Most-recent-first, matching how the list and dashboard read it.
    this.transactions = items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // The cash withdrawal's allocatedCash follows its itemized total.
    const w = this.withdrawals.find((x) => x.txId === withdrawalId)!;
    const tx = this.transactions.find((t) => t._id === withdrawalId)!;
    tx.allocatedCash = Math.round(w.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
  }

  private seedMerchants() {
    this.merchants = KNOWN_MERCHANTS.map((m) => {
      const key = merchantKey(m.name);
      const rows = this.transactions.filter((t) => t.merchant === key).length;
      return {
        id: nextId('merch'),
        key,
        category: m.category,
        updatedAt: daysAgo(Math.floor(rng() * 60) + 5).toISOString(),
        rows,
        usable: true,
      };
    });
  }

  private seedBudgets() {
    const now = new Date();
    const defaults: Record<string, number> = {
      food: 8000, transport: 5000, housing: 20000, health: 4000, entertainment: 3000, savings: 10000,
    };
    for (const [category, limit] of Object.entries(defaults)) {
      this.budgetLimits.push({ category, month: now.getMonth() + 1, year: now.getFullYear(), limit });
    }
  }

  private seedRecurring() {
    const now = monthKey(new Date());
    this.recurring = [
      { id: nextId('rec'), transactionName: 'Salary deposit', isIncome: true, amount: 52000, category: 'salary', dayOfMonth: 25, lastExecutedAt: daysAgo(0).toISOString(), lastPeriod: now },
      { id: nextId('rec'), transactionName: 'Rent', isIncome: false, amount: 18500, category: 'housing', dayOfMonth: 1, lastExecutedAt: daysAgo(25).toISOString(), lastPeriod: monthKey(daysAgo(25)) },
      { id: nextId('rec'), transactionName: 'Internet Hogar', isIncome: false, amount: 1850.5, category: 'housing', dayOfMonth: 10, lastExecutedAt: daysAgo(0).toISOString(), lastPeriod: now },
      { id: nextId('rec'), transactionName: 'Streaming Plus', isIncome: false, amount: 449, category: 'entertainment', dayOfMonth: 5, lastExecutedAt: daysAgo(20).toISOString(), lastPeriod: monthKey(daysAgo(20)) },
      { id: nextId('rec'), transactionName: 'Transfer to savings', isIncome: false, amount: 3000, category: 'savings', dayOfMonth: 15, lastExecutedAt: null, lastPeriod: null },
    ];
  }

  private seedTips() {
    this.tips = [
      { title: 'Dining out adds up', description: 'Cafe Plaza and Restaurante La Terraza together made up a large share of food spending this month.', category: 'food', icon: 'restaurant', priority: 'medium', potentialSaving: 'RD$1,200/mo' },
      { title: 'Fuel spending is steady', description: 'Gasolinera Este spending held flat month over month, which is a good sign for the transport budget.', category: 'transport', icon: 'directions_car', priority: 'low' },
      { title: 'Subscriptions worth a look', description: 'Streaming Plus renews every month even in weeks with little use; consider pausing it occasionally.', category: 'entertainment', icon: 'lightbulb', priority: 'high', potentialSaving: 'RD$449/mo' },
    ];
  }

  private seedIngestion() {
    const recent: MailBookedItem[] = this.transactions.slice(0, 3).map((t) => ({
      id: nextId('mail'),
      name: t.transactionName,
      amount: t.amount,
      isExpense: t.isExpense,
      category: t.category,
      timestamp: t.timestamp,
      transferKind: t.transferKind ?? null,
    }));
    const unreadable: UnreadableMailItem[] = [
      { id: nextId('unread'), sender: 'alertas@bank.example', subject: 'Notificacion de transaccion', receivedAt: daysAgo(2, 8, 5).toISOString(), attempts: 2, lastSeenAt: daysAgo(1, 8, 5).toISOString(), reason: 'Could not parse the amount' },
    ];
    this.ingestion = {
      ...this.ingestion,
      lastRun: { created: 2, alreadyBooked: 14, notTransactions: 3, unreadable: 1, bookingFailed: 0, unverified: 0, at: daysAgo(1, 6, 0).toISOString() },
      recent,
      unreadable,
    };
  }

  // ── Balance ──────────────────────────────────────────────────────────
  getBalanceSummary() {
    return {
      balance: this.balance,
      isPremium: this.isPremium,
      lastActivity: this.transactions[0]?.timestamp ?? new Date().toISOString(),
      language: this.language,
    };
  }

  /** Records a manual balance adjustment, the same way the real api would for a "set balance" action. */
  setBalance(balance: number, note?: string) {
    const previousBalance = this.balance;
    const delta = Math.round((balance - previousBalance) * 100) / 100;
    this.balance = Math.round(balance * 100) / 100;
    this.balanceHistory.push({
      id: nextId('bh'),
      timestamp: new Date().toISOString(),
      reason: 'manual',
      delta,
      newBalance: this.balance,
      name: note?.trim() || null,
    });
    return { previousBalance, newBalance: this.balance, delta };
  }

  getBalanceHistoryPage(opts: { limit?: number; offset?: number; before?: string; reason?: BalanceChangeReason }) {
    let items = [...this.balanceHistory].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (opts.reason) items = items.filter((i) => i.reason === opts.reason);
    const total = items.length;
    if (opts.before) items = items.filter((i) => i.timestamp < opts.before!);
    else if (opts.offset) items = items.slice(opts.offset);
    const limit = opts.limit ?? 20;
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? page[page.length - 1]?.timestamp ?? null : null;
    return { items: page, total, nextCursor };
  }

  getDailyBalance(days: number): DailyBalance[] {
    const sorted = [...this.balanceHistory].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: DailyBalance[] = [];
    let idx = 0;
    let running = sorted.length ? undefined : this.balance;
    // Balance before the very first recorded change: back it out from that change.
    if (sorted.length) running = Math.round((sorted[0].newBalance - sorted[0].delta) * 100) / 100;
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);
      while (idx < sorted.length && new Date(sorted[idx].timestamp).getTime() <= dayEnd.getTime()) {
        running = sorted[idx].newBalance;
        idx++;
      }
      result.push({ day: dayKey(day), balance: Math.round((running ?? 0) * 100) / 100 });
    }
    return result;
  }

  // ── Transactions ─────────────────────────────────────────────────────
  getTransactionsPage(opts: {
    limit?: number; offset?: number; before?: string; type?: 'income' | 'expense'; category?: string;
    startDate?: string; endDate?: string; needsReview?: boolean; unitemized?: boolean; search?: string;
  }) {
    let items = [...this.transactions];
    if (opts.type) items = items.filter((t) => (opts.type === 'expense') === t.isExpense);
    if (opts.category) items = items.filter((t) => t.category === opts.category);
    if (opts.startDate) items = items.filter((t) => t.timestamp >= opts.startDate!);
    if (opts.endDate) items = items.filter((t) => t.timestamp <= opts.endDate! + 'T23:59:59.999Z');
    if (opts.needsReview) items = items.filter((t) => !!t.categoryNeedsReview);
    if (opts.unitemized) items = items.filter((t) => t.isWithdrawal && t.isExpense && t.amount - (t.allocatedCash ?? 0) > 0.009);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      items = items.filter((t) => t.transactionName.toLowerCase().includes(q) || (t.merchant ?? '').includes(q));
    }
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const total = items.length;
    if (opts.before) items = items.filter((t) => t.timestamp < opts.before!);
    else if (opts.offset) items = items.slice(opts.offset);
    const limit = opts.limit ?? 20;
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? page[page.length - 1]?.timestamp ?? null : null;
    return { items: page, total, limit, offset: opts.offset ?? 0, nextCursor };
  }

  exportCsv(opts: { type?: string; category?: string; startDate?: string; endDate?: string; search?: string }): string {
    let items = [...this.transactions];
    if (opts.type) items = items.filter((t) => (opts.type === 'expense') === t.isExpense);
    if (opts.category) items = items.filter((t) => t.category === opts.category);
    const header = 'date,name,category,amount,type';
    const rows = items.map((t) =>
      [dayKey(new Date(t.timestamp)), `"${t.transactionName.replace(/"/g, '""')}"`, t.category, t.amount.toFixed(2), t.isExpense ? 'expense' : 'income'].join(','),
    );
    return [header, ...rows].join('\n');
  }

  setTransactionCategory(id: string, category: string): { alsoFiled: number } | null {
    const tx = this.transactions.find((t) => t._id === id);
    if (!tx) return null;
    const merchant = tx.merchant;
    tx.category = category;
    tx.categoryNeedsReview = false;
    let alsoFiled = 0;
    if (merchant) {
      for (const other of this.transactions) {
        if (other._id !== id && other.merchant === merchant && other.categoryNeedsReview) {
          other.category = category;
          other.categoryNeedsReview = false;
          alsoFiled++;
        }
      }
    }
    return { alsoFiled };
  }

  createTransaction(body: CreateTransactionRequest): { id: string } {
    const id = nextId('tx');
    const timestamp = body.timestamp ?? new Date().toISOString();
    const isExpense = body.type === 'expense';
    this.transactions.unshift({
      _id: id,
      transactionName: body.name,
      transactionType: isExpense ? 'purchase' : 'deposit',
      amount: body.amount,
      isExpense,
      timestamp,
      category: body.category,
      source: 'manual',
    });
    this.applyBalanceDelta(isExpense ? -body.amount : body.amount, isExpense ? 'expense' : 'income', body.name, timestamp);
    return { id };
  }

  updateTransaction(id: string, body: UpdateTransactionRequest): boolean {
    const tx = this.transactions.find((t) => t._id === id);
    if (!tx) return false;
    const oldDelta = tx.isExpense ? -tx.amount : tx.amount;
    if (body.name !== undefined) tx.transactionName = body.name;
    if (body.category !== undefined) tx.category = body.category;
    if (body.amount !== undefined) tx.amount = body.amount;
    if (body.timestamp !== undefined) tx.timestamp = body.timestamp;
    if (body.amount !== undefined) {
      const newDelta = tx.isExpense ? -tx.amount : tx.amount;
      if (newDelta !== oldDelta) {
        this.applyBalanceDelta(newDelta - oldDelta, tx.isExpense ? 'expense' : 'income', `${tx.transactionName} (edited)`, new Date().toISOString());
      }
    }
    return true;
  }

  deleteTransaction(id: string): boolean {
    const idx = this.transactions.findIndex((t) => t._id === id);
    if (idx === -1) return false;
    const [tx] = this.transactions.splice(idx, 1);
    // Deleting reverses the transaction's effect on the balance.
    const reversal = tx.isExpense ? tx.amount : -tx.amount;
    this.applyBalanceDelta(reversal, 'delete', tx.transactionName, new Date().toISOString());
    return true;
  }

  resolveTransfer(id: string, kind: 'internal' | 'external'): boolean {
    const tx = this.transactions.find((t) => t._id === id);
    if (!tx) return false;
    tx.transferKind = kind;
    return true;
  }

  private applyBalanceDelta(delta: number, reason: BalanceChangeReason, name: string, timestamp: string) {
    this.balance = Math.round((this.balance + delta) * 100) / 100;
    this.balanceHistory.push({ id: nextId('bh'), timestamp, reason, delta: Math.round(delta * 100) / 100, newBalance: this.balance, name });
  }

  // ── Cash ─────────────────────────────────────────────────────────────
  getCashBreakdown(withdrawalId: string) {
    const tx = this.transactions.find((t) => t._id === withdrawalId);
    const w = this.withdrawals.find((x) => x.txId === withdrawalId);
    if (!tx || !w) return null;
    const allocated = Math.round(w.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
    return {
      id: tx._id,
      name: tx.transactionName,
      timestamp: tx.timestamp,
      amount: tx.amount,
      allocated,
      remaining: Math.round((tx.amount - allocated) * 100) / 100,
      items: w.items,
    };
  }

  addCashItem(withdrawalId: string, category: string, amount: number, description?: string): { id: string } | null {
    const w = this.withdrawals.find((x) => x.txId === withdrawalId);
    const tx = this.transactions.find((t) => t._id === withdrawalId);
    if (!w || !tx) return null;
    const id = nextId('cash');
    w.items.push({ id, category, description: description ?? null, amount });
    tx.allocatedCash = Math.round(w.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
    return { id };
  }

  deleteCashItem(itemId: string): boolean {
    for (const w of this.withdrawals) {
      const idx = w.items.findIndex((it) => it.id === itemId);
      if (idx !== -1) {
        w.items.splice(idx, 1);
        const tx = this.transactions.find((t) => t._id === w.txId);
        if (tx) tx.allocatedCash = Math.round(w.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
        return true;
      }
    }
    return false;
  }

  // ── Budgets ──────────────────────────────────────────────────────────
  getBudget(month?: number, year?: number): BudgetEntry[] {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const categories = new Set(this.budgetLimits.filter((b) => b.month === m && b.year === y).map((b) => b.category));
    return [...categories].map((category) => {
      const limitEntry = this.budgetLimits.find((b) => b.category === category && b.month === m && b.year === y)!;
      const spent = this.transactions
        .filter((t) => t.isExpense && t.category === category && this.inMonth(t.timestamp, m, y))
        .reduce((s, t) => s + t.amount, 0);
      const limit = limitEntry.limit;
      const remaining = Math.round((limit - spent) * 100) / 100;
      const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      return { category, limit, spent: Math.round(spent * 100) / 100, remaining, percentage, month: m, year: y };
    });
  }

  setBudget(category: string, limitAmount: number, month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const existing = this.budgetLimits.find((b) => b.category === category && b.month === m && b.year === y);
    if (existing) existing.limit = limitAmount;
    else this.budgetLimits.push({ category, month: m, year: y, limit: limitAmount });
  }

  private inMonth(iso: string, month: number, year: number): boolean {
    const d = new Date(iso);
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  }

  // ── Statistics ───────────────────────────────────────────────────────
  getStatisticsSummary(month?: number, year?: number): MonthlySummary {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const inPeriod = this.transactions.filter((t) => this.inMonth(t.timestamp, m, y));
    const income = inPeriod.filter((t) => !t.isExpense).reduce((s, t) => s + t.amount, 0);
    const expense = inPeriod.filter((t) => t.isExpense).reduce((s, t) => s + t.amount, 0);
    return {
      month: m, year: y,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      net: Math.round((income - expense) * 100) / 100,
      transactionCount: inPeriod.length,
    };
  }

  getMonthlyStats(): MonthlyPoint[] {
    const points: MonthlyPoint[] = [];
    for (let back = 3; back >= 0; back--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - back);
      const inPeriod = this.transactions.filter((t) => this.inMonth(t.timestamp, d.getMonth() + 1, d.getFullYear()));
      points.push({
        label: monthLabel(d),
        income: Math.round(inPeriod.filter((t) => !t.isExpense).reduce((s, t) => s + t.amount, 0) * 100) / 100,
        expense: Math.round(inPeriod.filter((t) => t.isExpense).reduce((s, t) => s + t.amount, 0) * 100) / 100,
      });
    }
    return points;
  }

  getCategoryStats(month?: number, year?: number): { category: string; total: number }[] {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const totals = new Map<string, number>();
    for (const t of this.transactions) {
      if (!t.isExpense || !this.inMonth(t.timestamp, m, y)) continue;
      totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
    }
    return [...totals.entries()].map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }));
  }

  // ── Compare and analytics ────────────────────────────────────────────
  getCompareMonths(): string[] {
    const months: string[] = [];
    for (let back = 0; back < 4; back++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - back);
      months.push(monthKey(d));
    }
    return months;
  }

  private periodSummary(ym: string): PeriodSummary {
    const [year, month] = ym.split('-').map(Number);
    const inPeriod = this.transactions.filter((t) => this.inMonth(t.timestamp, month, year));
    const totalIncome = inPeriod.filter((t) => !t.isExpense).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = inPeriod.filter((t) => t.isExpense).reduce((s, t) => s + t.amount, 0);
    const byCategory = new Map<string, number>();
    for (const t of inPeriod.filter((t) => t.isExpense)) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    const topCategories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));
    return {
      month: ym,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      net: Math.round((totalIncome - totalExpenses) * 100) / 100,
      topCategories,
    };
  }

  compare(monthA: string, monthB: string): CompareResult {
    const a = this.periodSummary(monthA);
    const b = this.periodSummary(monthB);
    const diff = Math.round((b.totalExpenses - a.totalExpenses) * 100) / 100;
    const analysis = diff === 0
      ? `Expenses were about the same in both months.`
      : `Expenses were ${diff > 0 ? 'higher' : 'lower'} in ${fullMonthLabel(b.month)} than in ${fullMonthLabel(a.month)}, by roughly $${Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 })}.`;
    return { monthA: a, monthB: b, analysis };
  }

  getTop10(): TopTransaction[] {
    const byName = new Map<string, { count: number; total: number }>();
    for (const t of this.transactions.filter((t) => t.isExpense)) {
      const cur = byName.get(t.transactionName) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += t.amount;
      byName.set(t.transactionName, cur);
    }
    return [...byName.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, v], i) => ({ rank: i + 1, name, count: v.count, totalAmount: Math.round(v.total * 100) / 100 }));
  }

  getTransactionChart(name: string): ChartPoint[] {
    const points: ChartPoint[] = [];
    for (let back = 5; back >= 0; back--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - back);
      const total = this.transactions
        .filter((t) => t.transactionName === name && this.inMonth(t.timestamp, d.getMonth() + 1, d.getFullYear()))
        .reduce((s, t) => s + t.amount, 0);
      points.push({ month: monthLabel(d), total: Math.round(total * 100) / 100 });
    }
    return points;
  }

  // ── Growth calculator ────────────────────────────────────────────────
  compoundGrowth(input: GrowthInput): GrowthResult {
    const { start, monthly, rate, years } = input;
    const monthlyRate = rate / 100 / 12;
    let balance = start;
    let putIn = start;
    const yearsList = [];
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) {
        balance = balance * (1 + monthlyRate) + monthly;
        putIn += monthly;
      }
      yearsList.push({ year: y, balance: round2(balance), putIn: round2(putIn), interest: round2(balance - putIn) });
    }
    const finalBalance = round2(balance);
    return { finalBalance, putIn: round2(putIn), interest: round2(finalBalance - putIn), years: yearsList };
  }

  getMyNumbers(): MyNumbers {
    const months: MyNumbers['months'] = [];
    for (let back = 2; back >= 0; back--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - back);
      const inPeriod = this.transactions.filter((t) => this.inMonth(t.timestamp, d.getMonth() + 1, d.getFullYear()));
      const income = round2(inPeriod.filter((t) => !t.isExpense).reduce((s, t) => s + t.amount, 0));
      const expense = round2(inPeriod.filter((t) => t.isExpense).reduce((s, t) => s + t.amount, 0));
      months.push({ month: d.getMonth() + 1, year: d.getFullYear(), income, expense, net: round2(income - expense) });
    }
    const avgNet = months.reduce((s, m) => s + m.net, 0) / months.length;
    return {
      startingAmount: this.balance,
      monthlySavings: Math.max(0, round2(avgNet)),
      spentMore: months[months.length - 1].net < 0,
      months,
    };
  }

  // ── Recurring ────────────────────────────────────────────────────────
  getRecurring(): RecurringEntry[] {
    return this.recurring;
  }

  createRecurring(body: CreateRecurringRequest): { id: string } {
    const id = nextId('rec');
    this.recurring.push({
      id, transactionName: body.name, isIncome: body.type === 'income', amount: body.amount,
      category: body.category, dayOfMonth: body.dayOfMonth, lastExecutedAt: null, lastPeriod: null,
    });
    return { id };
  }

  deleteRecurring(id: string): boolean {
    const idx = this.recurring.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.recurring.splice(idx, 1);
    return true;
  }

  // ── Categories ───────────────────────────────────────────────────────
  getCategories(): CategoryEntry[] {
    return this.categories.map(({ active, pending, ...c }) => c);
  }

  private usageFor(name: string) {
    return {
      transactions: this.transactions.filter((t) => t.category === name).length,
      recurring: this.recurring.filter((r) => r.category === name).length,
      budgets: this.budgetLimits.filter((b) => b.category === name).length,
      cashItems: this.withdrawals.reduce((s, w) => s + w.items.filter((it) => it.category === name).length, 0),
    };
  }

  getCategoryOverview() {
    const categories: CategoryOverviewItem[] = this.categories.map((c) => ({
      id: c.id, name: c.name, emoji: c.emoji, color: c.color, isBuiltIn: c.isBuiltIn,
      active: c.active, usage: this.usageFor(c.name), pending: c.pending,
    }));
    return { categories, palette: PALETTE, emojis: EMOJIS };
  }

  createCategory(name: string, emoji: string, color: string): { id: string } {
    const id = nextId('cat');
    this.categories.push({ id, name, emoji, color, isBuiltIn: false, active: true, pending: null });
    return { id };
  }

  updateCategory(id: string, body: CategoryInput): { id: string } | null {
    const c = this.categories.find((x) => x.id === id);
    if (!c) return null;
    if (body.name !== undefined && body.name !== c.name) {
      const oldName = c.name;
      const newName = body.name;
      // A rename carries every reference along with it, the way the real api does.
      for (const t of this.transactions) if (t.category === oldName) t.category = newName;
      for (const r of this.recurring) if (r.category === oldName) r.category = newName;
      for (const b of this.budgetLimits) if (b.category === oldName) b.category = newName;
      for (const w of this.withdrawals) for (const it of w.items) if (it.category === oldName) it.category = newName;
      for (const m of this.merchants) if (m.category === oldName) m.category = newName;
      c.name = newName;
    }
    if (body.emoji !== undefined) c.emoji = body.emoji;
    if (body.color !== undefined) c.color = body.color;
    return { id };
  }

  /** With no data in the category, it's removed outright; otherwise it's marked pending until finishCategoryMove. */
  deleteCategory(id: string, moveTo?: string): boolean {
    const c = this.categories.find((x) => x.id === id);
    if (!c) return false;
    const usage = this.usageFor(c.name);
    const inUse = usage.transactions + usage.recurring + usage.budgets + usage.cashItems > 0;
    if (!inUse) {
      this.categories = this.categories.filter((x) => x.id !== id);
      return true;
    }
    if (!moveTo) return false;
    c.active = false;
    c.pending = { from: c.name, to: moveTo };
    return true;
  }

  finishCategoryMove(id: string): { id: string } | null {
    const c = this.categories.find((x) => x.id === id);
    if (!c || !c.pending) return null;
    const { from, to } = c.pending;
    for (const t of this.transactions) if (t.category === from) t.category = to;
    for (const r of this.recurring) if (r.category === from) r.category = to;
    for (const b of this.budgetLimits) if (b.category === from) b.category = to;
    for (const w of this.withdrawals) for (const it of w.items) if (it.category === from) it.category = to;
    for (const m of this.merchants) if (m.category === from) m.category = to;
    this.categories = this.categories.filter((x) => x.id !== id);
    return { id };
  }

  // ── Tips ─────────────────────────────────────────────────────────────
  getTips(): Tip[] {
    return this.tips;
  }

  refreshTips(): Tip[] {
    // A fresh pass would reorder by priority; simulate that without inventing new copy.
    this.tips = [...this.tips].sort(() => rng() - 0.5);
    return this.tips;
  }

  // ── Merchants ────────────────────────────────────────────────────────
  getMerchants(): RememberedMerchant[] {
    return this.merchants;
  }

  matchMerchant(name: string): MerchantMatch {
    const key = merchantKey(name);
    const remembered = this.merchants.find((m) => m.key === key);
    const rows = this.transactions.filter((t) => t.merchant === key).length;
    return { key, rows, remembered: remembered ? remembered.category : null };
  }

  addMerchant(name: string, category: string): { id: string; key: string; alsoFiled: number } {
    const key = merchantKey(name);
    const id = nextId('merch');
    this.merchants.push({ id, key, category, updatedAt: new Date().toISOString(), rows: 0, usable: true });
    let alsoFiled = 0;
    for (const t of this.transactions) {
      if (t.merchant === key && t.categoryNeedsReview) {
        t.category = category;
        t.categoryNeedsReview = false;
        alsoFiled++;
      }
    }
    const merch = this.merchants.find((m) => m.id === id)!;
    merch.rows = this.transactions.filter((t) => t.merchant === key).length;
    return { id, key, alsoFiled };
  }

  changeMerchant(id: string, category: string): { moved: number } | null {
    const m = this.merchants.find((x) => x.id === id);
    if (!m) return null;
    let moved = 0;
    for (const t of this.transactions) {
      if (t.merchant === m.key) {
        t.category = category;
        moved++;
      }
    }
    m.category = category;
    m.usable = true;
    m.updatedAt = new Date().toISOString();
    return { moved };
  }

  forgetMerchant(id: string): boolean {
    const idx = this.merchants.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.merchants.splice(idx, 1);
    return true;
  }

  // ── Settings ─────────────────────────────────────────────────────────
  getSettings(): SettingsView {
    return this.settings;
  }

  saveReportSettings(body: ReportsSettingsInput): SettingsView {
    this.settings = {
      ...this.settings,
      reports: {
        ...this.settings.reports,
        weekly: { value: body.weekly, source: 'saved' },
        monthly: { value: body.monthly, source: 'saved' },
        recipient: { value: body.recipient, source: body.recipient ? 'saved' : 'config' },
      },
    };
    return this.settings;
  }

  resetReportSettings(): SettingsView {
    this.settings = {
      ...this.settings,
      reports: {
        ...this.settings.reports,
        weekly: { value: true, source: 'config' },
        monthly: { value: true, source: 'config' },
        recipient: { value: null, source: 'config' },
      },
    };
    return this.settings;
  }

  saveAccountSettings(body: AccountsSettingsInput): SettingsView {
    this.settings = {
      ...this.settings,
      accounts: {
        cash: { value: body.cash, source: 'saved' },
        senders: { value: body.senders, source: 'saved' },
      },
    };
    return this.settings;
  }

  resetAccountSettings(): SettingsView {
    this.settings = {
      ...this.settings,
      accounts: {
        cash: { value: ['2001'], source: 'config' },
        senders: { value: ['alertas@bank.example'], source: 'config' },
      },
    };
    return this.settings;
  }

  // ── Ingestion ────────────────────────────────────────────────────────
  getIngestionStatus(): IngestionStatusView {
    return this.ingestion;
  }

  runIngestion(): RunCounts {
    const counts: RunCounts = { created: 0, alreadyBooked: 3, notTransactions: 1, unreadable: 0, bookingFailed: 0, unverified: 0 };
    this.ingestion = { ...this.ingestion, running: false, lastRun: { ...counts, at: new Date().toISOString() } };
    return counts;
  }

  dismissUnreadable(id: string): boolean {
    const before = this.ingestion.unreadable.length;
    this.ingestion = { ...this.ingestion, unreadable: this.ingestion.unreadable.filter((m) => m.id !== id) };
    return this.ingestion.unreadable.length < before;
  }
}

export const store = new PreviewStore();
