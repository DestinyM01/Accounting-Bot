import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BalanceSummary,
  BudgetEntry,
  CategoryEntry,
  CategoryPoint,
  ChartPoint,
  CompareResult,
  MonthlyPoint,
  MonthlySummary,
  RecurringEntry,
  SetBudgetRequest,
  Tip,
  TopTransaction,
  TransactionPage,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient) {}

  getBalance(): Observable<BalanceSummary> {
    return this.http.get<BalanceSummary>(`${this.base}/balance`);
  }

  getTransactions(opts: {
    limit?:     number;
    offset?:    number;
    type?:      'income' | 'expense';
    category?:  string;
    startDate?: string;
    endDate?:   string;
  } = {}): Observable<TransactionPage> {
    let params = new HttpParams();
    if (opts.limit)     params = params.set('limit',     opts.limit);
    if (opts.offset)    params = params.set('offset',    opts.offset);
    if (opts.type)      params = params.set('type',      opts.type);
    if (opts.category)  params = params.set('category',  opts.category);
    if (opts.startDate) params = params.set('startDate', opts.startDate);
    if (opts.endDate)   params = params.set('endDate',   opts.endDate);
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

  createCategory(body: { name: string; emoji: string; color: string }): Observable<void> {
    return this.http.post<void>(`${this.base}/categories`, body);
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/categories/${id}`);
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
}
