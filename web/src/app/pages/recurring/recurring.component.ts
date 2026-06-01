import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { RecurringEntry } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';

@Component({
  selector: 'app-recurring',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './recurring.component.html',
  styleUrls: ['./recurring.component.scss'],
})
export class RecurringComponent implements OnInit {
  items: RecurringEntry[] = [];
  loading = false;
  error = '';

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.error = '';
    this.api.getRecurring().subscribe({
      next: (data) => { this.items = data; this.loading = false; },
      error: () => { this.error = 'Failed to load recurring transactions.'; this.loading = false; },
    });
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
      next: () => { this.items = this.items.filter(r => r.id !== item.id); },
      error: () => { alert('Failed to delete. Please try again.'); },
    });
  }
}
