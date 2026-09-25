import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { ChartPoint, TopTransaction } from '../../core/services/api.models';
import { HOVER_COLUMN, axisStyle, chartTheme, moneyLabel, tooltipStyle, withAlpha } from '../../core/ui/chart-theme';

Chart.register(...registerables);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  top10:        TopTransaction[] = [];
  selectedName  = '';
  chartLoading  = false;
  loading       = true;
  error         = '';
  private chart: Chart | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getTop10().subscribe({
      next:  (data) => { this.top10 = data; this.loading = false; },
      error: ()     => { this.error = 'Failed to load analytics.'; this.loading = false; },
    });
  }

  ngOnDestroy() {
    if (this.chart) { this.chart.destroy(); }
  }

  selectTransaction(name: string) {
    if (this.selectedName === name) return;
    this.selectedName = name;
    this.chartLoading = true;
    this.api.getTransactionChart(name).subscribe({
      next:  (points) => { this.chartLoading = false; setTimeout(() => this.buildChart(points), 0); },
      error: ()       => { this.chartLoading = false; },
    });
  }

  private buildChart(points: ChartPoint[]) {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas) return;

    const t = chartTheme();
    const bar = (_: unknown, i: number, arr: unknown[]) => (i === arr.length - 1 ? t.income : withAlpha(t.income, 0.35));
    this.chart = new Chart(canvas.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: points.map(p => p.month),
        datasets: [{
          data: points.map(p => p.total),
          backgroundColor: points.map(bar),
          hoverBackgroundColor: points.map(bar),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
