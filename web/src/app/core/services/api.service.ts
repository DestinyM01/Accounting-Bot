import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BalanceSummary,
  BudgetEntry,
  CategoryPoint,
  MonthlyPoint,
  MonthlySummary,
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
    limit?: number;
    offset?: number;
    type?: 'income' | 'expense';
    category?: string;
  } = {}): Observable<TransactionPage> {
    let params = new HttpParams();
    if (opts.limit)    params = params.set('limit', opts.limit);
    if (opts.offset)   params = params.set('offset', opts.offset);
    if (opts.type)     params = params.set('type', opts.type);
    if (opts.category) params = params.set('category', opts.category);
    return this.http.get<TransactionPage>(`${this.base}/transactions`, { params });
  }

  getBudget(month?: number, year?: number): Observable<BudgetEntry[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year', year);
    return this.http.get<BudgetEntry[]>(`${this.base}/budget`, { params });
  }

  getStatisticsSummary(month?: number, year?: number): Observable<MonthlySummary> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year', year);
    return this.http.get<MonthlySummary>(`${this.base}/statistics/summary`, { params });
  }

  getMonthlyStats(): Observable<MonthlyPoint[]> {
    return this.http.get<MonthlyPoint[]>(`${this.base}/statistics/monthly`);
  }

  getCategoryStats(month?: number, year?: number): Observable<CategoryPoint[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year', year);
    return this.http.get<CategoryPoint[]>(`${this.base}/statistics/by-category`, { params });
  }
}
