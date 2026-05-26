import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { ChartPoint, TopTransaction } from '../../core/services/api.models';

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

    this.chart = new Chart(canvas.getContext('2d')!, {
      type: 'bar',
      data: {
        labels:   points.map(p => p.month),
        datasets: [{
          data:            points.map(p => p.total),
          backgroundColor: points.map((_, i, arr) =>
            i === arr.length - 1 ? '#10e5a0' : 'rgba(16,229,160,0.35)'
          ),
          borderRadius: 4,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: {
            backgroundColor: '#0e1726',
            borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
            titleColor: '#94a3b8', bodyColor: '#e2e8f0',
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
        },
      },
    });
  }
}
