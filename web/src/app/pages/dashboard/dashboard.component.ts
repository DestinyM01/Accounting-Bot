import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, timer, merge, Subscription, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import {
  BalanceSummary, BudgetEntry, MonthlySummary, Transaction, MonthlyPoint
} from '../../core/services/api.models';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import { CategoryService } from '../../core/services/category.service';
import { HOVER_COLUMN, axisStyle, chartTheme, moneyLabel, tooltipStyle, withAlpha } from '../../core/ui/chart-theme';

Chart.register(...registerables);

interface StatCard {
  label: string;
  amount: number;
  icon: string;
  cls: string;
  badgeDir: 'up' | 'down' | 'neutral';
  badgePct: number | null;
  sub: string | null;
  link?: string;
}

@Component({
    selector: 'app-dashboard',
    imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, MatIconModule],
    templateUrl: './dashboard.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('areaCanvas') areaCanvas!: ElementRef<HTMLCanvasElement>;

  balance: BalanceSummary | null = null;
  summary: MonthlySummary | null = null;
  recentTx: Transaction[] = [];
  budgets: BudgetEntry[] = [];
  monthly: MonthlyPoint[] = [];
  stats: StatCard[] = [];
  loading = true;
  /** The last refresh failed: the page keeps what it last showed and tries again on the next tick. */
  refreshError = false;
  private chart: Chart | null = null;
  private sub: Subscription | null = null;
  private destroyed = false;

  constructor(private api: ApiService, private events: TransactionEventsService, private catSvc: CategoryService) {}

  ngOnInit() {
    this.sub = merge(timer(0, 60_000), this.events.changed$)
      .pipe(switchMap(() => forkJoin({
        balance:      this.api.getBalance(),
        summary:      this.api.getStatisticsSummary(),
        transactions: this.api.getTransactions({ limit: 5 }),
        budget:       this.api.getBudget(),
        monthly:      this.api.getMonthlyStats(),
      }).pipe(
        // Inside switchMap: a failed refresh ends only itself. Outside, the
        // first error would complete the stream and the page would never
        // refresh again.
        catchError(() => { this.refreshError = true; return EMPTY; }),
      )))
      .subscribe((d) => {
        this.refreshError = false;
        this.balance  = d.balance;
        this.summary  = d.summary;
        this.recentTx = d.transactions.items;
        this.budgets  = d.budget;
        this.monthly  = d.monthly;
        this.buildStats(d.monthly);
        this.loading  = false;
        // defer one tick so *ngIf renders the canvas before we grab it
        setTimeout(() => { if (!this.destroyed) this.buildChart(); }, 0);
      });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.sub?.unsubscribe();
    this.chart?.destroy();
    this.chart = null;
  }

  private buildStats(monthly: MonthlyPoint[]) {
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
    const curr = monthly.length >= 1 ? monthly[monthly.length - 1] : null;

    const pct = (a: number, b: number): number =>
      b === 0 ? 0 : Math.round(((a - b) / Math.abs(b)) * 100 * 10) / 10;

    this.stats = [
      {
        label: 'Total Balance',
        amount: this.balance?.balance ?? 0,
        icon: 'account_balance',
        cls: '',
        badgeDir: 'neutral',
        badgePct: null,
        sub: `${this.summary?.transactionCount ?? 0} transactions this month`,
        link: '/balance',
      },
      {
        label: 'Monthly Income',
        amount: curr?.income ?? 0,
        icon: 'trending_up',
        cls: 'income',
        badgeDir: prev && curr && curr.income >= prev.income ? 'up' : 'down',
        badgePct: prev ? pct(curr?.income ?? 0, prev.income) : null,
        sub: null,
      },
      {
        label: 'Monthly Expenses',
        amount: curr?.expense ?? 0,
        icon: 'trending_down',
        cls: 'expense',
        badgeDir: prev && curr && curr.expense <= prev.expense ? 'up' : 'down',
        badgePct: prev ? pct(curr?.expense ?? 0, prev.expense) : null,
        sub: null,
      },
      {
        label: 'Net Savings',
        amount: (curr?.income ?? 0) - (curr?.expense ?? 0),
        icon: 'savings',
        cls: 'net',
        badgeDir: 'neutral',
        badgePct: null,
        sub: `${this.summary?.transactionCount ?? 0} transactions this month`,
      },
    ];
  }

  // called from template once loading = false and canvas is in DOM
  buildChart() {
    // Rebuilds happen every 60s and after every write (see ngOnInit); only the
    // very first build should animate in — otherwise the lines redraw from
    // zero on a timer, which reads as a flicker rather than a live update.
    const isFirstBuild = !this.chart;
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const canvas = this.areaCanvas?.nativeElement;
    if (!canvas || !this.monthly.length) return;

    const t = chartTheme();
    const ctx = canvas.getContext('2d')!;
    const gradIncome = ctx.createLinearGradient(0, 0, 0, 300);
    gradIncome.addColorStop(0, withAlpha(t.income, 0.25));
    gradIncome.addColorStop(1, withAlpha(t.income, 0));
    const gradExpense = ctx.createLinearGradient(0, 0, 0, 300);
    gradExpense.addColorStop(0, withAlpha(t.expense, 0.15));
    gradExpense.addColorStop(1, withAlpha(t.expense, 0));

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.monthly.map(m => m.label),
        datasets: [
          {
            label: 'Income',
            data: this.monthly.map(m => m.income),
            borderColor: t.income,
            borderWidth: 2,
            pointRadius: 0,
            pointBackgroundColor: t.income,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: t.income,
            pointHoverBorderColor: t.income,
            fill: true,
            backgroundColor: gradIncome,
            tension: 0.4,
          },
          {
            label: 'Expenses',
            data: this.monthly.map(m => m.expense),
            borderColor: t.expense,
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            pointBackgroundColor: t.expense,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: t.expense,
            pointHoverBorderColor: t.expense,
            fill: true,
            backgroundColor: gradExpense,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: isFirstBuild ? undefined : false,
        interaction: HOVER_COLUMN,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle(t), callbacks: { label: moneyLabel } },
        },
        scales: {
          x: axisStyle(t),
          y: axisStyle(t),
        },
      },
    });
  }

  /** The category's own colour, custom categories included. */
  categoryColor(category: string): string {
    return this.catSvc.color(category);
  }

  categoryIcon(category: string): string {
    const map: Record<string, string> = {
      housing: 'home', food: 'restaurant', transport: 'directions_car',
      health: 'medical_services', entertainment: 'movie', salary: 'payments',
      savings: 'savings', other: 'receipt_long',
    };
    return map[category.toLowerCase()] ?? 'category';
  }

  txIcon(tx: Transaction): string { return this.categoryIcon(tx.category); }

  badgeLabel(pct: number | null, dir: 'up'|'down'|'neutral'): string {
    if (pct === null) return '';
    const arrow = dir === 'up' ? '↑' : '↓';
    return `${arrow} ${Math.abs(pct)}%`;
  }
}
