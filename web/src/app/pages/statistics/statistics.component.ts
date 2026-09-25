import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Chart, registerables } from 'chart.js';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryPoint, MonthlyPoint, MonthlySummary } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { HOVER_COLUMN, axisStyle, chartTheme, moneyLabel, tooltipStyle, withAlpha } from '../../core/ui/chart-theme';

Chart.register(...registerables);

interface DistRow {
  category: string;
  total: number;
  pct: number;
  color: string;
  icon: string;
}

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DecimalPipe, MatIconModule],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss'],
})
export class StatisticsComponent implements OnInit {
  @ViewChild('areaCanvas') areaCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('savingsCanvas') savingsCanvas!: ElementRef<HTMLCanvasElement>;

  summary: MonthlySummary | null = null;
  distribution: DistRow[] = [];
  monthly: MonthlyPoint[] = [];
  loading = true;
  private areaChart: Chart | null = null;
  private savingsChart: Chart | null = null;

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() {
    forkJoin({
      summary:    this.api.getStatisticsSummary(),
      monthly:    this.api.getMonthlyStats(),
      byCategory: this.api.getCategoryStats(),
    }).subscribe({
      next: ({ summary, monthly, byCategory }) => {
        this.summary  = summary;
        this.monthly  = monthly;
        this.buildDistribution(byCategory);
        this.loading  = false;
        setTimeout(() => { this.buildAreaChart(); this.buildSavingsChart(); }, 0);
      },
      error: () => { this.loading = false; },
    });
  }

  catColor(cat: string) { return this.catSvc.color(cat); }
  catIcon(cat: string)  { return this.catSvc.icon(cat);  }

  private buildDistribution(data: CategoryPoint[]) {
    const total = data.reduce((s, d) => s + d.total, 0);
    this.distribution = data.map(d => ({
      category: d.category,
      total:    d.total,
      pct:      total > 0 ? Math.round(d.total / total * 100) : 0,
      color:    this.catSvc.color(d.category),
      icon:     this.catSvc.icon(d.category),
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

    this.savingsChart = new Chart(canvas.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: this.monthly.slice(-6).map(m => m.label),
        datasets: [{
          data: savingsRates.slice(-6),
          backgroundColor: savingsRates.slice(-6).map((_, i, arr) =>
            i === arr.length - 1 ? t.income : withAlpha(t.income, 0.35)
          ),
          hoverBackgroundColor: savingsRates.slice(-6).map((_, i, arr) =>
            i === arr.length - 1 ? t.income : withAlpha(t.income, 0.35)
          ),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
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
}
