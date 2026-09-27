import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, timer, merge, Subscription, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import {
  BalanceSummary, BudgetEntry, DailyBalance, Transaction, MonthlyPoint, TransactionPage
} from '../../core/services/api.models';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import { CategoryService } from '../../core/services/category.service';
import { HOVER_COLUMN, axisStyle, chartTheme, moneyLabel, tooltipStyle, withAlpha } from '../../core/ui/chart-theme';
import { IconComponent } from '../../core/ui/icon/icon.component';
import { ThemeService } from '../../core/ui/theme.service';

Chart.register(...registerables);

/** The sparkline's own coordinate space; the SVG stretches to its container via preserveAspectRatio="none". */
const SPARK_W = 300;
const SPARK_H = 72;
const SPARK_PAD_Y = 4;

@Component({
    selector: 'app-dashboard',
    imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, IconComponent],
    templateUrl: './dashboard.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('areaCanvas') areaCanvas!: ElementRef<HTMLCanvasElement>;

  balance: BalanceSummary | null = null;
  recentTx: Transaction[] = [];
  budgets: BudgetEntry[] = [];
  monthly: MonthlyPoint[] = [];
  daily: DailyBalance[] = [];
  review: TransactionPage | null = null;
  loading = true;
  /** The last refresh failed: the page keeps what it last showed and tries again on the next tick. */
  refreshError = false;
  /** Set on each successful load; drives the "Updated h:mm a" line. */
  updatedAt: Date | null = null;

  // Derived from `monthly`, recomputed on each load — see applyMonthly().
  monthLabel = '';
  currentIncome = 0;
  currentExpense = 0;
  netThisMonth = 0;
  incomeTone: 'pos' | 'neg' | 'neutral' = 'neutral';
  incomeBadgePct: number | null = null;
  expenseTone: 'pos' | 'neg' | 'neutral' = 'neutral';
  expenseBadgePct: number | null = null;

  // Derived from `budgets` — see applyBudgets().
  budgetUsedPct: number | null = null;

  private chart: Chart | null = null;
  private sub: Subscription | null = null;
  private destroyed = false;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private api: ApiService,
    private events: TransactionEventsService,
    private catSvc: CategoryService,
    private theme: ThemeService,
  ) {}

  ngOnInit() {
    // Colours are read from tokens at build time, so the chart just rebuilds on theme change.
    this.theme.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.buildChart());
    this.sub = merge(timer(0, 60_000), this.events.changed$)
      .pipe(switchMap(() => forkJoin({
        balance:      this.api.getBalance(),
        transactions: this.api.getTransactions({ limit: 5 }),
        budget:       this.api.getBudget(),
        monthly:      this.api.getMonthlyStats(),
        daily:        this.api.getDailyBalance(30),
        review:       this.api.getTransactions({ needsReview: true, limit: 1 }),
      }).pipe(
        // Inside switchMap: a failed refresh ends only itself. Outside, the
        // first error would complete the stream and the page would never
        // refresh again.
        catchError(() => { this.refreshError = true; return EMPTY; }),
      )))
      .subscribe((d) => {
        this.refreshError = false;
        this.balance  = d.balance;
        this.recentTx = d.transactions.items;
        this.budgets  = d.budget;
        this.monthly  = d.monthly;
        this.daily    = d.daily;
        this.review   = d.review;
        this.applyMonthly(d.monthly);
        this.applyBudgets(d.budget);
        this.loading  = false;
        this.updatedAt = new Date();
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

  private applyMonthly(monthly: MonthlyPoint[]) {
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
    const curr = monthly.length >= 1 ? monthly[monthly.length - 1] : null;

    const pct = (a: number, b: number): number =>
      b === 0 ? 0 : Math.round(((a - b) / Math.abs(b)) * 100 * 10) / 10;

    this.monthLabel = curr?.label ?? '';
    this.currentIncome = curr?.income ?? 0;
    this.currentExpense = curr?.expense ?? 0;
    this.netThisMonth = this.currentIncome - this.currentExpense;

    // The arrow always follows the raw sign of the change (up = the number grew); the
    // tone is which way is "good" for that figure — more income is positive, more
    // expense is negative — so they can and do point in different directions.
    this.incomeBadgePct = prev ? pct(this.currentIncome, prev.income) : null;
    this.incomeTone = this.tone(this.incomeBadgePct, 'pos');

    this.expenseBadgePct = prev ? pct(this.currentExpense, prev.expense) : null;
    this.expenseTone = this.tone(this.expenseBadgePct, 'neg');
  }

  /** `whenUp` is the tone for a positive change (an increase); a negative change gets the other one. */
  private tone(pct: number | null, whenUp: 'pos' | 'neg'): 'pos' | 'neg' | 'neutral' {
    if (pct === null || pct === 0) return 'neutral';
    const whenDown = whenUp === 'pos' ? 'neg' : 'pos';
    return pct > 0 ? whenUp : whenDown;
  }

  private applyBudgets(budgets: BudgetEntry[]) {
    if (!budgets.length) { this.budgetUsedPct = null; return; }
    const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
    const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
    this.budgetUsedPct = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 1000) / 10 : 0;
  }

  /** Scale factor (0..1) for the budget-used bar; capped so it never overflows the track. */
  get budgetBarScale(): number {
    return this.budgetUsedPct === null ? 0 : Math.min(this.budgetUsedPct / 100, 1);
  }

  /** The needs-review count, from the review page's total (not just the one item fetched). */
  get reviewCount(): number {
    return this.review?.total ?? 0;
  }

  /** A flat SVG polyline "x,y x,y ..." from the last 30 days of balances, normalised to the sparkline's viewBox. Draws a flat mid-line when every value is equal. */
  get sparklinePoints(): string {
    const vals = this.daily.map((d) => d.balance);
    if (vals.length < 2) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const flat = max === min;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * SPARK_W;
        const y = flat
          ? SPARK_H / 2
          : SPARK_H - SPARK_PAD_Y - ((v - min) / (max - min)) * (SPARK_H - SPARK_PAD_Y * 2);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  /** The category's own colour, custom categories included. */
  categoryColor(category: string): string {
    return this.catSvc.color(category);
  }

  categoryIcon(category: string): string {
    const map: Record<string, string> = {
      housing: 'home', food: 'tools-kitchen-2', transport: 'car',
      health: 'first-aid-kit', entertainment: 'movie', salary: 'cash-banknote',
      savings: 'pig-money', other: 'receipt',
    };
    return map[category.toLowerCase()] ?? 'tag';
  }

  txIcon(tx: Transaction): string { return this.categoryIcon(tx.category); }

  isTransfer(tx: Transaction): boolean {
    return tx.transferKind === 'internal' || tx.transferKind === 'unresolved';
  }

  /** Scale factor (0..1) for one budget row's bar; capped so an over-budget row doesn't overflow. */
  budgetRowScale(b: BudgetEntry): number {
    return Math.min(b.percentage / 100, 1);
  }

  /** The arrow reflects only the sign of the change itself, never which tone it renders in. */
  badgeLabel(pct: number | null): string {
    if (pct === null) return '';
    const arrow = pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '';
    return `${arrow}${Math.abs(pct)}%`;
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
}
