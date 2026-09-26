import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { RecurringEntry } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { Chart, registerables } from 'chart.js';
import { SankeyController, Flow } from 'chartjs-chart-sankey';
import { chartTheme, tooltipStyle } from '../../core/ui/chart-theme';

Chart.register(...registerables, SankeyController, Flow);

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd … 31st. */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

@Component({
    selector: 'app-recurring',
    imports: [CommonModule, TitleCasePipe, FormsModule, MatIconModule],
    templateUrl: './recurring.component.html',
    styleUrls: ['./recurring.component.scss']
})
export class RecurringComponent implements OnInit, OnDestroy {
  items: RecurringEntry[] = [];
  loading = false;
  error = '';

  showForm = false; saving = false;
  fType: 'income' | 'expense' = 'expense'; fAmount: number | null = null; fName = ''; fCategory = 'other'; fDay = 1;
  formError = '';
  get categories(): string[] { return this.catSvc.all.map(c => c.name); }
  get formValid() { return !!this.fAmount && this.fAmount > 0 && !!this.fName.trim() && Number.isInteger(this.fDay) && this.fDay >= 1 && this.fDay <= 28; }

  toggleForm() {
    this.showForm = !this.showForm;
    this.formError = '';
  }

  submitForm() {
    if (!this.formValid || this.saving) return;
    this.saving = true;
    this.formError = '';
    this.api.createRecurring({ type: this.fType, amount: this.fAmount!, name: this.fName, category: this.fCategory, dayOfMonth: this.fDay })
      .subscribe({
        next: () => { this.saving = false; this.showForm = false; this.fAmount = null; this.fName = ''; this.load(); },
        error: (e: { status?: number; error?: { message?: string } }) => {
          this.saving = false;
          this.formError = e?.error?.message ?? 'Could not create the rule.';
        },
      });
  }

  @ViewChild('flowCanvas') flowCanvas?: ElementRef<HTMLCanvasElement>;
  private flowChart: Chart | null = null;

  private readonly HUB = 'hub';
  private readonly SAV = 'sav';

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
    const hasIncome  = this.items.some(r => r.isIncome  && r.amount > 0);
    const hasExpense = this.items.some(r => !r.isIncome && r.amount > 0);
    return hasIncome && hasExpense;
  }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, c => c.toUpperCase());
  }

  private buildFlowChart() {
    if (this.flowChart) { this.flowChart.destroy(); this.flowChart = null; }
    if (!this.showFlowChart) return;
    const canvas = this.flowCanvas?.nativeElement;
    if (!canvas) return;

    const income  = this.items.filter(r => r.isIncome  && r.amount > 0);
    const expense = this.items.filter(r => !r.isIncome && r.amount > 0);
    const totalIncome  = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
    const surplus = totalIncome - totalExpense;

    const data: { from: string; to: string; flow: number }[] = [];
    const labels: Record<string, string> = { [this.HUB]: 'Monthly Income', [this.SAV]: 'Savings' };
    const t = chartTheme();
    const colors: Record<string, string> = { [this.HUB]: t.accent, [this.SAV]: t.income };

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

    const nodeColor = (name: string) => colors[name] ?? t.muted;

    this.flowChart = new Chart(canvas, {
      type: 'sankey',
      data: {
        datasets: [{
          data,
          labels,
          colorFrom: (c: any) => nodeColor(c.dataset.data[c.dataIndex].from),
          colorTo:   (c: any) => nodeColor(c.dataset.data[c.dataIndex].to),
          colorMode: 'gradient',
          color: t.text,
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
            ...tooltipStyle(t),
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
  /** 'YYYY-MM' of a date's month, in the browser's (the user's) time. */
  private periodOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** The month the scheduler last handled this rule. Rules from before lastPeriod existed fall back to lastExecutedAt's month, as the scheduler does. */
  private handledPeriod(r: RecurringEntry): string | null {
    if (r.lastPeriod) return r.lastPeriod;
    return r.lastExecutedAt ? this.periodOf(new Date(r.lastExecutedAt)) : null;
  }

  get billedThisMonth(): RecurringEntry[] {
    const current = this.periodOf(new Date());
    return this.items.filter(r => this.handledPeriod(r) === current);
  }

  /** The bill's due day this month ("Sep 20"), not when the booking ran. */
  billedDate(r: RecurringEntry): string {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = Math.min(r.dayOfMonth, lastDay);
    return new Date(now.getFullYear(), now.getMonth(), day)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  categoryIcon(cat: string): string  { return this.catSvc.icon(cat);  }
  categoryColor(cat: string): string { return this.catSvc.color(cat); }

  scheduleLabel(day: number): string {
    return `Every ${ordinal(day)}`;
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
