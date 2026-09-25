import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { GrowthInput, GrowthResult, MyNumbers } from '../../core/services/api.models';

Chart.register(...registerables);

/** How savings grow with compound interest; the math runs (and is tested) in the api. */
@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, MatIconModule],
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.scss'],
})
export class CalculatorComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;

  // The bot's own example, read the way its help text meant it.
  start: number | null = 0;
  monthly: number | null = 1000;
  rate: number | null = 10;
  years: number | null = 15;

  result: GrowthResult | null = null;
  /** The inputs no longer match the result on screen (they're invalid, or the last request failed). */
  stale = false;
  inputError = '';
  loading = false;
  showTable = false;

  mine: MyNumbers | null = null;
  mineLoading = false;
  mineError = '';

  private gen = 0;
  private destroyed = false;
  private chart: Chart | null = null;
  private readonly changes$ = new Subject<void>();
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.subs.add(this.changes$.pipe(debounceTime(300)).subscribe(() => this.calculate()));
    this.calculate();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    this.chart?.destroy();
  }

  onChange() {
    this.changes$.next();
  }

  /** "Jul–Sep", for the note under "Use my numbers". */
  get mineSpan(): string {
    const months = this.mine?.months ?? [];
    if (months.length === 0) return '';
    const name = (m: { month: number; year: number }) => new Date(m.year, m.month - 1, 1).toLocaleString('en', { month: 'short' });
    return `${name(months[0])}–${name(months[months.length - 1])}`;
  }

  /** The chart's text alternative. */
  get chartSummary(): string {
    const r = this.result;
    if (!r) return '';
    const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const years = r.years.length === 1 ? '1 year' : `${r.years.length} years`;
    return `After ${years}: ${money(r.finalBalance)} — ${money(r.putIn)} put in, ${money(r.interest)} interest`;
  }

  useMyNumbers() {
    if (this.mineLoading) return;
    this.mineLoading = true;
    this.mineError = '';
    this.subs.add(
      this.api.getMyNumbers().subscribe({
        next: (n) => {
          this.mineLoading = false;
          this.mine = n;
          this.start = n.startingAmount;
          this.monthly = n.monthlySavings;
          this.calculate();
        },
        error: (e: HttpErrorResponse) => {
          this.mineLoading = false;
          this.mineError = this.message(e, "Couldn't load your numbers.");
        },
      }),
    );
  }

  private calculate() {
    const input = this.readInput();
    if (typeof input === 'string') {
      this.inputError = input;
      this.stale = !!this.result;
      // Bump the generation and drop loading so a reply already in flight can't overwrite this invalid state.
      ++this.gen;
      this.loading = false;
      return;
    }
    const gen = ++this.gen;
    this.loading = true;
    this.subs.add(
      this.api.compoundGrowth(input).subscribe({
        next: (r) => {
          if (gen !== this.gen) return; // a newer calculation owns the page
          this.loading = false;
          this.result = r;
          this.stale = false;
          this.inputError = '';
          setTimeout(() => this.draw(), 0); // the canvas renders with the first result
        },
        error: (e: HttpErrorResponse) => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.inputError = this.message(e, "Couldn't calculate. Please try again.");
          this.stale = !!this.result;
        },
      }),
    );
  }

  /** The fields as the api expects them, or why they can't be sent yet. The api checks the ranges. */
  private readInput(): GrowthInput | string {
    const values = [this.start, this.monthly, this.rate, this.years];
    if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'Fill in all four fields.';
    return { start: this.start!, monthly: this.monthly!, rate: this.rate!, years: this.years! };
  }

  private draw() {
    const canvas = this.chartCanvas?.nativeElement;
    const r = this.result;
    if (this.destroyed || !canvas || !r) return;
    // Theme colours, read at runtime so the chart follows the design tokens.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    // Same formatting as the Balance page's tooltip.
    const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const first = !this.chart;
    this.chart?.destroy();
    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: r.years.map((y) => `Year ${y.year}`),
        datasets: [
          { label: 'Put in', data: r.years.map((y) => y.putIn), backgroundColor: token('--text-muted'), stack: 'total' },
          { label: 'Interest', data: r.years.map((y) => y.interest), backgroundColor: token('--accent'), stack: 'total' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: first ? undefined : false,
        plugins: {
          legend: { labels: { color: token('--text-muted') } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y ?? 0)}` } },
        },
        scales: {
          x: { stacked: true, grid: { color: token('--border') }, ticks: { color: token('--text-muted'), maxTicksLimit: 10 } },
          y: {
            stacked: true,
            grid: { color: token('--border') },
            ticks: {
              color: token('--text-muted'),
              callback: (value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
            },
          },
        },
      },
    });
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }
}
