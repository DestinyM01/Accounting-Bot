import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AccountsSettingsInput,
  BalanceChangeReason,
  BalanceHistoryPage,
  BalanceSummary,
  BudgetEntry,
  CashBreakdown,
  CashItemInput,
  CategoryEntry,
  CategoryInput,
  CategoryOverview,
  CategoryPoint,
  ChartPoint,
  CompareResult,
  CreateRecurringRequest,
  CreateTransactionRequest,
  DailyBalance,
  GrowthInput,
  GrowthResult,
  IngestionStatusView,
  MonthlyPoint,
  MonthlySummary,
  MyNumbers,
  RecurringEntry,
  ReportsSettingsInput,
  RunCounts,
  SetBalanceResult,
  SetBudgetRequest,
  SettingsView,
  Tip,
  TopTransaction,
  TransactionPage,
  UpdateTransactionRequest,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient) {}

  getBalance(): Observable<BalanceSummary> {
    return this.http.get<BalanceSummary>(`${this.base}/balance`);
  }

  /** Sets the balance to the total the user's accounts show; recorded as a manual adjustment. */
  setBalance(balance: number, note?: string): Observable<SetBalanceResult> {
    return this.http.put<SetBalanceResult>(`${this.base}/balance`, note ? { balance, note } : { balance });
  }

  getBalanceHistory(opts: { limit?: number; offset?: number; reason?: BalanceChangeReason } = {}): Observable<BalanceHistoryPage> {
    let params = new HttpParams();
    if (opts.limit !== undefined) params = params.set('limit', opts.limit);
    if (opts.offset !== undefined) params = params.set('offset', opts.offset);
    if (opts.reason) params = params.set('reason', opts.reason);
    return this.http.get<BalanceHistoryPage>(`${this.base}/balance/history`, { params });
  }

  getDailyBalance(days = 90): Observable<DailyBalance[]> {
    return this.http.get<DailyBalance[]>(`${this.base}/balance/daily`, { params: new HttpParams().set('days', days) });
  }

  getTransactions(opts: {
    limit?:       number;
    offset?:      number;
    type?:        'income' | 'expense';
    category?:    string;
    startDate?:   string;
    endDate?:     string;
    needsReview?: boolean;
    unitemized?:  boolean;
  } = {}): Observable<TransactionPage> {
    let params = new HttpParams();
    if (opts.limit)       params = params.set('limit',       opts.limit);
    if (opts.offset)      params = params.set('offset',      opts.offset);
    if (opts.type)        params = params.set('type',        opts.type);
    if (opts.category)    params = params.set('category',    opts.category);
    if (opts.startDate)   params = params.set('startDate',   opts.startDate);
    if (opts.endDate)     params = params.set('endDate',     opts.endDate);
    if (opts.needsReview) params = params.set('needsReview', opts.needsReview);
    if (opts.unitemized)  params = params.set('unitemized',  opts.unitemized);
    return this.http.get<TransactionPage>(`${this.base}/transactions`, { params });
  }

  exportTransactions(opts: {
    type?:      'income' | 'expense';
    category?:  string;
    startDate?: string;
    endDate?:   string;
  } = {}): Observable<Blob> {
    let params = new HttpParams();
    if (opts.type)      params = params.set('type',      opts.type);
    if (opts.category)  params = params.set('category',  opts.category);
    if (opts.startDate) params = params.set('startDate', opts.startDate);
    if (opts.endDate)   params = params.set('endDate',   opts.endDate);
    return this.http.get(`${this.base}/transactions/export`, { params, responseType: 'blob' });
  }

  /** Sets a category and clears the review flag; also answers how many of the merchant's other waiting rows were filed. */
  setTransactionCategory(id: string, category: string): Observable<{ alsoFiled: number }> {
    return this.http.patch<{ alsoFiled: number }>(`${this.base}/transactions/${id}/category`, { category });
  }

  getCashBreakdown(withdrawalId: string): Observable<CashBreakdown> {
    return this.http.get<CashBreakdown>(`${this.base}/cash/withdrawals/${withdrawalId}`);
  }

  addCashItem(withdrawalId: string, body: CashItemInput): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/cash/withdrawals/${withdrawalId}/allocations`, body);
  }

  deleteCashItem(itemId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/cash/allocations/${itemId}`);
  }

  getBudget(month?: number, year?: number): Observable<BudgetEntry[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<BudgetEntry[]>(`${this.base}/budget`, { params });
  }

  setBudget(body: SetBudgetRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/budget`, body);
  }

  getStatisticsSummary(month?: number, year?: number): Observable<MonthlySummary> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<MonthlySummary>(`${this.base}/statistics/summary`, { params });
  }

  getMonthlyStats(): Observable<MonthlyPoint[]> {
    return this.http.get<MonthlyPoint[]>(`${this.base}/statistics/monthly`);
  }

  getCategoryStats(month?: number, year?: number): Observable<CategoryPoint[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<CategoryPoint[]>(`${this.base}/statistics/by-category`, { params });
  }

  getRecurring(): Observable<RecurringEntry[]> {
    return this.http.get<RecurringEntry[]>(`${this.base}/recurring`);
  }

  deleteRecurring(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/recurring/${id}`);
  }

  getCategories(): Observable<CategoryEntry[]> {
    return this.http.get<CategoryEntry[]>(`${this.base}/categories`);
  }

  getCategoryOverview(): Observable<CategoryOverview> {
    return this.http.get<CategoryOverview>(`${this.base}/categories/overview`);
  }

  createCategory(body: { name: string; emoji: string; color: string }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/categories`, body);
  }

  updateCategory(id: string, body: CategoryInput): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`${this.base}/categories/${id}`, body);
  }

  /** `moveTo` is required by the api while the category is in use. */
  deleteCategory(id: string, moveTo?: string): Observable<void> {
    const params = moveTo ? new HttpParams().set('moveTo', moveTo) : undefined;
    return this.http.delete<void>(`${this.base}/categories/${id}`, { params });
  }

  finishCategoryMove(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/categories/${id}/finish`, {});
  }

  getTips(): Observable<Tip[]> {
    return this.http.get<Tip[]>(`${this.base}/tips`);
  }

  refreshTips(): Observable<Tip[]> {
    return this.http.post<Tip[]>(`${this.base}/tips/refresh`, {});
  }

  getCompareMonths(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/compare/months`);
  }

  compare(monthA: string, monthB: string): Observable<CompareResult> {
    return this.http.post<CompareResult>(`${this.base}/compare`, { monthA, monthB });
  }

  getTop10(): Observable<TopTransaction[]> {
    return this.http.get<TopTransaction[]>(`${this.base}/analytics/top10`);
  }

  getTransactionChart(name: string): Observable<ChartPoint[]> {
    return this.http.get<ChartPoint[]>(`${this.base}/analytics/chart/${encodeURIComponent(name)}`);
  }

  createTransaction(body: CreateTransactionRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/transactions`, body);
  }

  updateTransaction(id: string, body: UpdateTransactionRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/transactions/${id}`, body);
  }

  deleteTransaction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/transactions/${id}`);
  }

  resolveTransfer(id: string, kind: 'internal' | 'external'): Observable<void> {
    return this.http.patch<void>(`${this.base}/transactions/${id}/transfer-kind`, { kind });
  }

  /** Emails the latest weekly digest now, marked [Test]. 503 when email isn't configured on the server. */
  sendTestDigest(): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`${this.base}/reports/test`, {});
  }

  getSettings(): Observable<SettingsView> {
    return this.http.get<SettingsView>(`${this.base}/settings`);
  }

  saveReportSettings(body: ReportsSettingsInput): Observable<SettingsView> {
    return this.http.put<SettingsView>(`${this.base}/settings/reports`, body);
  }

  saveAccountSettings(body: AccountsSettingsInput): Observable<SettingsView> {
    return this.http.put<SettingsView>(`${this.base}/settings/accounts`, body);
  }

  getIngestionStatus(): Observable<IngestionStatusView> {
    return this.http.get<IngestionStatusView>(`${this.base}/ingestion/status`);
  }

  /** Checks bank mail now. 409 while a check is already running. */
  runIngestion(): Observable<RunCounts> {
    return this.http.post<RunCounts>(`${this.base}/ingestion/run`, {});
  }

  dismissUnreadable(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/ingestion/unreadable/${id}/dismiss`, {});
  }

  createRecurring(body: CreateRecurringRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/recurring`, body);
  }

  compoundGrowth(input: GrowthInput): Observable<GrowthResult> {
    const params = new HttpParams()
      .set('start', input.start)
      .set('monthly', input.monthly)
      .set('rate', input.rate)
      .set('years', input.years);
    return this.http.get<GrowthResult>(`${this.base}/calculator/compound`, { params });
  }

  getMyNumbers(): Observable<MyNumbers> {
    return this.http.get<MyNumbers>(`${this.base}/calculator/my-numbers`);
  }
}
