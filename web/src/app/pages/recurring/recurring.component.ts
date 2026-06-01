import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { RecurringEntry } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { Chart, registerables } from 'chart.js';
import { SankeyController, Flow } from 'chartjs-chart-sankey';

Chart.register(...registerables, SankeyController, Flow);

@Component({
  selector: 'app-recurring',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './recurring.component.html',
  styleUrls: ['./recurring.component.scss'],
})
export class RecurringComponent implements OnInit, OnDestroy {
  items: RecurringEntry[] = [];
  loading = false;
  error = '';

  @ViewChild('flowCanvas') flowCanvas?: ElementRef<HTMLCanvasElement>;
  private flowChart: Chart | null = null;

  private readonly HUB = 'hub';
  private readonly SAV = 'sav';
  private readonly HUB_COLOR = '#14b8a6';
  private readonly SAV_COLOR = '#34d399';

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.error = '';
    this.api.getRecurring().subscribe({
      next: (data) => {
        this.items = data;
        this.loading = false;
        setTimeout(() => this.buildFlowChart(), 0);
      },
      error: () => { this.error = 'Failed to load recurring transactions.'; this.loading = false; },
    });
  }

  // ── Flow chart ───────────────────────────────────────────────────────
  /** Only show the flow chart when there's both income and expense to connect. */
  get showFlowChart(): boolean {
    const hasIncome  = this.items.some(r => r.isIncome);
    const hasExpense = this.items.some(r => !r.isIncome);
    return hasIncome && hasExpense;
  }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, c => c.toUpperCase());
  }

  buildFlowChart() {
    if (this.flowChart) { this.flowChart.destroy(); this.flowChart = null; }
    if (!this.showFlowChart) return;
    const canvas = this.flowCanvas?.nativeElement;
    if (!canvas) return;

    const income  = this.items.filter(r => r.isIncome);
    const expense = this.items.filter(r => !r.isIncome);
    const totalIncome  = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
    const surplus = totalIncome - totalExpense;

    const data: { from: string; to: string; flow: number }[] = [];
    const labels: Record<string, string> = { [this.HUB]: 'Monthly Income', [this.SAV]: 'Savings' };
    const colors: Record<string, string> = { [this.HUB]: this.HUB_COLOR, [this.SAV]: this.SAV_COLOR };

    income.forEach(r => {
      const key = `in:${r.id}`;
      data.push({ from: key, to: this.HUB, flow: r.amount });
      labels[key] = this.titleCase(r.transactionName);
      colors[key] = this.categoryColor(r.category);
    });
    expense.forEach(r => {
      const key = `out:${r.id}`;
      data.push({ from: this.HUB, to: key, flow: r.amount });
      labels[key] = this.titleCase(r.transactionName);
      colors[key] = this.categoryColor(r.category);
    });
    if (surplus > 0) {
      data.push({ from: this.HUB, to: this.SAV, flow: surplus });
    }

    const nodeColor = (name: string) => colors[name] ?? '#94a3b8';

    this.flowChart = new Chart(canvas, {
      type: 'sankey',
      data: {
        datasets: [{
          data,
          labels,
          colorFrom: (c: any) => nodeColor(c.dataset.data[c.dataIndex].from),
          colorTo:   (c: any) => nodeColor(c.dataset.data[c.dataIndex].to),
          colorMode: 'gradient',
          borderWidth: 0,
          nodeWidth: 14,
          nodePadding: 14,
        } as any],
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
            callbacks: {
              label: (ctx: any) => {
                const d = ctx.dataset.data[ctx.dataIndex];
                const from = labels[d.from] ?? d.from;
                const to   = labels[d.to]   ?? d.to;
                return `${from} → ${to}: ${d.flow.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
              },
            },
          },
        },
      },
    });
  }

  ngOnDestroy() {
    if (this.flowChart) { this.flowChart.destroy(); this.flowChart = null; }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  get totalMonthlyIncome(): number {
    return this.items.filter(r => r.isIncome).reduce((s, r) => s + r.amount, 0);
  }

  get totalMonthlyExpense(): number {
    return this.items.filter(r => !r.isIncome).reduce((s, r) => s + r.amount, 0);
  }

  // ── Upcoming next ─────────────────────────────────────────────────────
  get upcomingNext(): RecurringEntry | null {
    if (!this.items.length) return null;
    return this.items.reduce((nearest, r) => {
      return this.daysUntil(r.dayOfMonth) < this.daysUntil(nearest.dayOfMonth) ? r : nearest;
    });
  }

  daysUntil(day: number): number {
    const today = new Date();
    const todayDay = today.getDate();
    if (day >= todayDay) return day - todayDay;
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return (daysInMonth - todayDay) + day;
  }

  nextBillingDate(day: number): Date {
    const today = new Date();
    if (day >= today.getDate()) {
      return new Date(today.getFullYear(), today.getMonth(), day);
    }
    return new Date(today.getFullYear(), today.getMonth() + 1, day);
  }

  monthAbbr(day: number): string {
    return this.nextBillingDate(day).toLocaleString('en', { month: 'short' }).toUpperCase();
  }

  // ── Billed this month ─────────────────────────────────────────────────
  get billedThisMonth(): RecurringEntry[] {
    const now = new Date();
    return this.items.filter(r => {
      if (!r.lastExecutedAt) return false;
      const d = new Date(r.lastExecutedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }

  billedDate(r: RecurringEntry): string {
    if (!r.lastExecutedAt) return '';
    return new Date(r.lastExecutedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  categoryIcon(cat: string): string  { return this.catSvc.icon(cat);  }
  categoryColor(cat: string): string { return this.catSvc.color(cat); }

  scheduleLabel(day: number): string {
    const s = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    return `Every ${day}${s}`;
  }

  trackById(_: number, r: RecurringEntry) { return r.id; }

  deleteItem(item: RecurringEntry) {
    if (!window.confirm(`Delete "${item.transactionName}"? This cannot be undone.`)) return;
    this.api.deleteRecurring(item.id).subscribe({
      next: () => {
        this.items = this.items.filter(r => r.id !== item.id);
        setTimeout(() => this.buildFlowChart(), 0);
      },
      error: () => { alert('Failed to delete. Please try again.'); },
    });
  }
}
