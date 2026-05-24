import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartData, ChartOptions, registerables } from 'chart.js';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryPoint, MonthlyPoint, MonthlySummary } from '../../core/services/api.models';

Chart.register(...registerables);

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, MatCardModule, BaseChartDirective],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss'],
})
export class StatisticsComponent implements OnInit {
  summary: MonthlySummary | null = null;
  loading = true;

  barData: ChartData<'bar'> = { labels: [], datasets: [] };
  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    plugins: { legend: { labels: { color: '#e0e0e0' } } },
    scales: {
      x: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
      y: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
    },
  };

  doughnutData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    plugins: { legend: { position: 'right', labels: { color: '#e0e0e0' } } },
  };

  constructor(private api: ApiService) {}

  ngOnInit() {
    forkJoin({
      summary: this.api.getStatisticsSummary(),
      monthly: this.api.getMonthlyStats(),
      byCategory: this.api.getCategoryStats(),
    }).subscribe({
      next: ({ summary, monthly, byCategory }) => {
        this.summary = summary;
        this.buildBarChart(monthly);
        this.buildDoughnut(byCategory);
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  private buildBarChart(data: MonthlyPoint[]) {
    this.barData = {
      labels: data.map((d) => d.label),
      datasets: [
        { label: 'Income',  data: data.map((d) => d.income),  backgroundColor: 'rgba(102,187,106,0.7)' },
        { label: 'Expense', data: data.map((d) => d.expense), backgroundColor: 'rgba(239,83,80,0.7)' },
      ],
    };
  }

  private buildDoughnut(data: CategoryPoint[]) {
    const COLORS = ['#7c83f5','#66bb6a','#ef5350','#ffa726','#42a5f5','#ab47bc','#26c6da','#d4e157'];
    this.doughnutData = {
      labels: data.map((d) => d.category),
      datasets: [{
        data: data.map((d) => d.total),
        backgroundColor: data.map((_, i) => COLORS[i % COLORS.length]),
      }],
    };
  }
}
