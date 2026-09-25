import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import {
  BalanceChangeReason,
  BalanceHistoryItem,
  BalanceSummary,
  DailyBalance,
} from '../../core/services/api.models';
import { HOVER_COLUMN, axisStyle, chartTheme, tooltipStyle } from '../../core/ui/chart-theme';

Chart.register(...registerables);

type Filter = 'all' | BalanceChangeReason;

const PAGE_SIZE = 20;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MINUS = '−';
/** The api rejects totals beyond this; don't offer to send one. */
const MAX_ABS_BALANCE = 1e12;

@Component({
  selector: 'app-balance',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, MatIconModule],
  templateUrl: './balance.component.html',
  styleUrls: ['./balance.component.scss'],
})
export class BalanceComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('setBtn') setBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('amountInput') amountInput?: ElementRef<HTMLInputElement>;

  readonly kindLabel: Record<BalanceChangeReason, string> = {
    income: 'Income',
    expense: 'Expense',
    delete: 'Deleted',
    manual: 'Set by you',
    recurring: 'Recurring',
  };
  readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    ...(Object.keys(this.kindLabel) as BalanceChangeReason[]).map((value) => ({ value, label: this.kindLabel[value] })),
  ];

  balance: BalanceSummary | null = null;
  headerLoading = true;
  headerError = '';

  daily: DailyBalance[] = [];
  chartError = '';
  chartLoading = false;

  filter: Filter = 'all';
  items: BalanceHistoryItem[] = [];
  total = 0;
  listLoading = false;
  loadingMore = false;
  listError = '';
  moreError = '';

  formOpen = false;
  amount: number | null = null;
  note = '';
  saving = false;
  formError = '';

  private chart: Chart | null = null;
  private readonly subs = new Subscription();
  private destroyed = false;
  private headerGen = 0;
  private chartGen = 0;
  private listGen = 0;

  constructor(private api: ApiService, private events: TransactionEventsService) {}

  ngOnInit(): void {
    // Any write anywhere (this page's form, the + button, a row action) reloads the page.
    this.subs.add(this.events.changed$.subscribe(() => this.reloadAll()));
    this.reloadAll();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subs.unsubscribe();
    this.chart?.destroy();
    this.chart = null;
  }

  get current(): number {
    return this.balance?.balance ?? 0;
  }

  get hasMore(): boolean {
    return this.items.length < this.total;
  }

  /** The adjustment the form would record, or null when the amount is not a usable number. */
  get delta(): number | null {
    if (this.amount === null || !Number.isFinite(this.amount) || Math.abs(this.amount) > MAX_ABS_BALANCE) return null;
    return Math.round((this.amount - this.current) * 100) / 100;
  }

  get canConfirm(): boolean {
    return !this.saving && this.delta !== null && this.delta !== 0;
  }

  get preview(): string {
    const d = this.delta;
    if (d === null || this.amount === null) return '';
    if (d === 0) return 'No change.';
    return `This records an adjustment of ${this.signed(d)} (from ${this.money(this.current)} to ${this.money(this.amount)}).`;
  }

  money(n: number): string {
    return `${n < 0 ? MINUS : ''}${USD.format(Math.abs(n))}`;
  }

  signed(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${USD.format(Math.abs(n))}`;
  }

  rowName(h: BalanceHistoryItem): string {
    if (h.reason === 'manual') return h.name || 'Balance set';
    return h.name || this.kindLabel[h.reason];
  }

  openForm(): void {
    this.formOpen = true;
    this.amount = this.current;
    this.note = '';
    this.formError = '';
    setTimeout(() => {
      if (this.destroyed) return;
      this.amountInput?.nativeElement.focus();
      this.amountInput?.nativeElement.select();
    }, 0);
  }

  cancelForm(): void {
    if (this.saving) return;
    this.formOpen = false;
    this.formError = '';
    this.focusSetButton();
  }

  confirm(): void {
    if (!this.canConfirm || this.amount === null) return;
    this.saving = true;
    this.formError = '';
    const note = this.note.trim();
    this.subs.add(
      this.api.setBalance(this.amount, note || undefined).subscribe({
        next: () => {
          this.saving = false;
          this.formOpen = false;
          this.focusSetButton();
          this.events.notify(); // reloads this page (see ngOnInit) and the Dashboard
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.formError = typeof e.error?.message === 'string' ? e.error.message : "Couldn't set the balance.";
        },
      }),
    );
  }

  setFilter(f: Filter): void {
    if (f === this.filter) return;
    this.filter = f;
    this.items = [];
    this.total = 0;
    this.moreError = '';
    this.loadList();
  }

  loadMore(): void {
    if (this.loadingMore || !this.hasMore) return;
    const gen = this.listGen;
    this.loadingMore = true;
    this.subs.add(
      this.api
        .getBalanceHistory({ limit: PAGE_SIZE, offset: this.items.length, reason: this.filter === 'all' ? undefined : this.filter })
        .subscribe({
          next: (page) => {
            if (gen !== this.listGen) return;
            this.loadingMore = false;
            const seen = new Set(this.items.map((i) => i.id));
            this.items = [...this.items, ...page.items.filter((i) => !seen.has(i.id))];
            this.total = page.total;
            this.moreError = '';
          },
          error: () => {
            if (gen !== this.listGen) return;
            this.loadingMore = false;
            this.moreError = "Couldn't load more history.";
          },
        }),
    );
  }

  /** The Set balance button re-renders when the form closes; give it focus back. */
  private focusSetButton(): void {
    setTimeout(() => {
      if (!this.destroyed) this.setBtn?.nativeElement.focus();
    }, 0);
  }

  private reloadAll(): void {
    this.loadHeader();
    this.loadChart();
    this.loadList();
  }

  private loadHeader(): void {
    const gen = ++this.headerGen;
    this.subs.add(
      this.api.getBalance().subscribe({
        next: (b) => {
          if (gen !== this.headerGen) return;
          this.balance = b;
          this.headerError = '';
          this.headerLoading = false;
        },
        error: () => {
          if (gen !== this.headerGen) return;
          this.headerError = "Couldn't load the balance.";
          this.headerLoading = false;
        },
      }),
    );
  }

  private loadChart(): void {
    const gen = ++this.chartGen;
    this.chartLoading = true;
    this.subs.add(
      this.api.getDailyBalance(90).subscribe({
        next: (points) => {
          if (gen !== this.chartGen) return;
          this.daily = points;
          this.chartError = '';
          this.chartLoading = false;
          // Build on the next tick, after this change-detection pass has rendered.
          setTimeout(() => {
            if (!this.destroyed && gen === this.chartGen) this.buildChart();
          }, 0);
        },
        error: () => {
          if (gen !== this.chartGen) return;
          this.chartError = "Couldn't load the chart.";
          this.chartLoading = false;
        },
      }),
    );
  }

  private loadList(): void {
    const gen = ++this.listGen;
    this.listLoading = true;
    this.listError = '';
    this.moreError = '';
    this.loadingMore = false;
    this.subs.add(
      this.api
        .getBalanceHistory({ limit: PAGE_SIZE, offset: 0, reason: this.filter === 'all' ? undefined : this.filter })
        .subscribe({
          next: (page) => {
            if (gen !== this.listGen) return;
            this.listLoading = false;
            this.items = page.items;
            this.total = page.total;
            this.listError = '';
          },
          error: () => {
            if (gen !== this.listGen) return;
            this.listLoading = false;
            this.listError = "Couldn't load the history.";
          },
        }),
    );
  }

  private buildChart(): void {
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas) return;
    const isFirstBuild = !this.chart;
    this.chart?.destroy();

    const t = chartTheme();
    const label = (day: string) =>
      new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: this.daily.map((p) => label(p.day)),
        datasets: [
          {
            data: this.daily.map((p) => p.balance),
            borderColor: t.accent,
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            pointBackgroundColor: t.accent,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: t.accent,
            pointHoverBorderColor: t.accent,
            fill: false,
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
          tooltip: { ...tooltipStyle(t), callbacks: { label: (c) => this.money(c.parsed.y!) } },
        },
        scales: {
          x: { ...axisStyle(t), ticks: { ...axisStyle(t).ticks, maxTicksLimit: 6 } },
          y: axisStyle(t),
        },
      },
    });
  }
}
