import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import {
  BalanceSummary, BudgetEntry, MonthlySummary, Transaction, MonthlyPoint
} from '../../core/services/api.models';

Chart.register(...registerables);

interface StatCard {
  label: string;
  amount: number;
  icon: string;
  cls: string;
  badgeDir: 'up' | 'down' | 'neutral';
  badgePct: number | null;
  sub: string | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, MatIconModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  @ViewChild('areaCanvas') areaCanvas!: ElementRef<HTMLCanvasElement>;

  balance: BalanceSummary | null = null;
  summary: MonthlySummary | null = null;
  recentTx: Transaction[] = [];
  budgets: BudgetEntry[] = [];
  monthly: MonthlyPoint[] = [];
  stats: StatCard[] = [];
  loading = true;
  private chart: Chart | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    forkJoin({
      balance:      this.api.getBalance(),
      summary:      this.api.getStatisticsSummary(),
      transactions: this.api.getTransactions({ limit: 5 }),
      budget:       this.api.getBudget(),
      monthly:      this.api.getMonthlyStats(),
    }).subscribe({
      next: (d) => {
        this.balance  = d.balance;
        this.summary  = d.summary;
        this.recentTx = d.transactions.items;
        this.budgets  = d.budget;
        this.monthly  = d.monthly;
        this.buildStats(d.monthly);
        this.loading  = false;
        // defer one tick so *ngIf renders the canvas before we grab it
        setTimeout(() => this.buildChart(), 0);
      },
      error: () => { this.loading = false; },
    });
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
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const canvas = this.areaCanvas?.nativeElement;
    if (!canvas || !this.monthly.length) return;

    const ctx = canvas.getContext('2d')!;
    const gradIncome  = ctx.createLinearGradient(0, 0, 0, 300);
    gradIncome.addColorStop(0,   'rgba(16,229,160,0.25)');
    gradIncome.addColorStop(1,   'rgba(16,229,160,0)');
    const gradExpense = ctx.createLinearGradient(0, 0, 0, 300);
    gradExpense.addColorStop(0,  'rgba(248,113,113,0.15)');
    gradExpense.addColorStop(1,  'rgba(248,113,113,0)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.monthly.map(m => m.label),
        datasets: [
          {
            label: 'Income',
            data: this.monthly.map(m => m.income),
            borderColor: '#10e5a0',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            backgroundColor: gradIncome,
            tension: 0.4,
          },
          {
            label: 'Expenses',
            data: this.monthly.map(m => m.expense),
            borderColor: '#f87171',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: true,
            backgroundColor: gradExpense,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0e1726',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#e2e8f0',
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
        },
      },
    });
  }

  categoryColor(category: string): string {
    const map: Record<string, string> = {
      housing: '#38bdf8', food: '#10e5a0', transport: '#fb923c',
      health: '#a78bfa', entertainment: '#f472b6', salary: '#10e5a0',
      savings: '#34d399', other: '#94a3b8',
    };
    return map[category.toLowerCase()] ?? '#64748b';
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
