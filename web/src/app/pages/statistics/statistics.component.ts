import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import { forkJoin, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryPoint, MonthlyPoint, MonthlySummary } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { HOVER_COLUMN, axisStyle, chartTheme, moneyLabel, tooltipStyle, withAlpha } from '../../core/ui/chart-theme';
import { changeArrow, changeTone } from '../../core/ui/change-tone';
import { IconComponent } from '../../core/ui/icon/icon.component';
import { ThemeService } from '../../core/ui/theme.service';

Chart.register(...registerables);

interface DistRow {
  category: string;
  total: number;
  pct: number;
  color: string;
}

@Component({
    selector: 'app-statistics',
    imports: [CommonModule, CurrencyPipe, DecimalPipe, IconComponent],
    templateUrl: './statistics.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./statistics.component.scss']
})
export class StatisticsComponent implements OnInit, OnDestroy {
  @ViewChild('areaCanvas') areaCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('savingsCanvas') savingsCanvas!: ElementRef<HTMLCanvasElement>;

  summary: MonthlySummary | null = null;
  distribution: DistRow[] = [];
  monthly: MonthlyPoint[] = [];
  loading = true;
  error: string | null = null;
  private areaChart: Chart | null = null;
  private savingsChart: Chart | null = null;
  private sub: Subscription | null = null;
  private destroyed = false;

  private readonly destroyRef = inject(DestroyRef);

  constructor(private api: ApiService, private catSvc: CategoryService, private theme: ThemeService) {}

  ngOnInit() {
    // Colours are read from tokens at build time, so the charts just rebuild on theme change.
    this.theme.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.buildAreaChart();
      this.buildSavingsChart();
    });
    this.sub = forkJoin({
      summary:    this.api.getStatisticsSummary(),
      monthly:    this.api.getMonthlyStats(),
      byCategory: this.api.getCategoryStats(),
    }).subscribe({
      next: ({ summary, monthly, byCategory }) => {
        this.error    = null;
        this.summary  = summary;
        this.monthly  = monthly;
        this.buildDistribution(byCategory);
        this.loading  = false;
        setTimeout(() => {
          if (this.destroyed) return;
          this.buildAreaChart(); this.buildSavingsChart();
        }, 0);
      },
      error: () => { this.loading = false; this.error = "Couldn't load statistics."; },
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.sub?.unsubscribe();
    this.areaChart?.destroy();
    this.areaChart = null;
    this.savingsChart?.destroy();
    this.savingsChart = null;
  }

  private buildDistribution(data: CategoryPoint[]) {
    const total = data.reduce((s, d) => s + d.total, 0);
    this.distribution = data.map(d => ({
      category: d.category,
      total:    d.total,
      pct:      total > 0 ? Math.round(d.total / total * 100) : 0,
      color:    this.catSvc.color(d.category),
    }));
  }

  private buildAreaChart() {
    if (this.areaChart) { this.areaChart.destroy(); this.areaChart = null; }
    const canvas = this.areaCanvas?.nativeElement;
    if (!canvas || !this.monthly.length) return;

    const t = chartTheme();
    const ctx = canvas.getContext('2d')!;
    const gIncome = ctx.createLinearGradient(0, 0, 0, 260);
    gIncome.addColorStop(0, withAlpha(t.income, 0.28));
    gIncome.addColorStop(1, withAlpha(t.income, 0));
    const gExpense = ctx.createLinearGradient(0, 0, 0, 260);
    gExpense.addColorStop(0, withAlpha(t.expense, 0.18));
    gExpense.addColorStop(1, withAlpha(t.expense, 0));

    this.areaChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.monthly.map(m => m.label),
        datasets: [
          {
            label: 'Income',
            data: this.monthly.map(m => m.income),
            borderColor: t.income, borderWidth: 2,
            fill: true, backgroundColor: gIncome,
            pointRadius: 0, pointBackgroundColor: t.income, pointHoverRadius: 4,
            pointHoverBackgroundColor: t.income, pointHoverBorderColor: t.income,
            tension: 0.4,
          },
          {
            label: 'Expenses',
            data: this.monthly.map(m => m.expense),
            borderColor: t.expense, borderWidth: 2,
            fill: true, backgroundColor: gExpense,
            pointRadius: 0, pointBackgroundColor: t.expense, pointHoverRadius: 4,
            pointHoverBackgroundColor: t.expense, pointHoverBorderColor: t.expense,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
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

  private buildSavingsChart() {
    if (this.savingsChart) { this.savingsChart.destroy(); this.savingsChart = null; }
    const canvas = this.savingsCanvas?.nativeElement;
    if (!canvas || !this.monthly.length) return;

    const savingsRates = this.monthly.map(m =>
      m.income > 0 ? Math.round((m.income - m.expense) / m.income * 100) : 0
    );
    const t = chartTheme();
    const barColor = (rate: number, isLast: boolean) =>
      rate < 0 ? t.expense : (isLast ? t.income : withAlpha(t.income, 0.35));

    this.savingsChart = new Chart(canvas.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: this.monthly.map(m => m.label),
        datasets: [{
          data: savingsRates,
          backgroundColor: savingsRates.map((r, i, arr) => barColor(r, i === arr.length - 1)),
          hoverBackgroundColor: savingsRates.map((r, i, arr) => barColor(r, i === arr.length - 1)),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle(t), callbacks: { label: (c: { parsed: { y: number | null } }) => `${c.parsed.y ?? 0}%` } },
        },
        scales: {
          x: axisStyle(t),
          y: { ...axisStyle(t), ticks: { ...axisStyle(t).ticks, callback: (v: string | number) => `${v}%` } },
        },
      },
    });
  }

  get savingsRate(): number {
    if (!this.summary || this.summary.income === 0) return 0;
    return Math.round(this.summary.net / this.summary.income * 1000) / 10;
  }

  get savingsRateChange(): number {
    if (this.monthly.length < 2) return 0;
    const prev = this.monthly[this.monthly.length - 2];
    const curr = this.monthly[this.monthly.length - 1];
    const pPrev = prev.income > 0 ? (prev.income - prev.expense) / prev.income * 100 : 0;
    const pCurr = curr.income > 0 ? (curr.income - curr.expense) / curr.income * 100 : 0;
    return Math.round((pCurr - pPrev) * 10) / 10;
  }

  /** The current calendar month's name, for tiles and headings that are really about
   * this month (the api's `/summary` and `/by-category` both default to it), not the
   * 12-month chart data. Derived from a Date rather than the api's monthly label
   * (e.g. "Sep 26"), which isn't fit for prose. */
  get monthName(): string {
    return new Date().toLocaleString('en', { month: 'long' });
  }

  /** The page-title-meta line: the current month's transaction count, plus a note
   * that the charts below cover the full 12 months. */
  get pageMeta(): string {
    if (!this.summary) return 'The last 12 months';
    return `${this.monthName}: ${this.summary.transactionCount} transactions · 12 months charted`;
  }

  /** The savings-rate chart normally covers all 12 months of `monthly`; this only
   * differs when the api actually returned fewer (e.g. a newer account). */
  get savingsChartRangeLabel(): string | null {
    return this.monthly.length === 12 ? null : `Last ${this.monthly.length} months`;
  }

  /** A higher savings rate than last month is good; a lower one is bad. */
  get savingsRateTone(): 'pos' | 'neg' | 'neutral' {
    return changeTone(this.savingsRateChange, true);
  }

  savingsRateBadgeLabel(): string {
    return `${changeArrow(this.savingsRateChange)}${Math.abs(this.savingsRateChange)} pts vs last month`;
  }
}
