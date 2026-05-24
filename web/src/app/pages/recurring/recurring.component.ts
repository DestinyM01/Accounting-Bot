import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { RecurringEntry } from '../../core/services/api.models';

const CATEGORY_ICONS: Record<string, string> = {
  food:          'restaurant',
  transport:     'directions_car',
  housing:       'home',
  health:        'medical_services',
  entertainment: 'movie',
  salary:        'account_balance_wallet',
  savings:       'savings',
  other:         'receipt_long',
};

const CATEGORY_COLORS: Record<string, string> = {
  food:          '#f59e0b',
  transport:     '#38bdf8',
  housing:       '#a78bfa',
  health:        '#34d399',
  entertainment: '#f87171',
  salary:        '#10e5a0',
  savings:       '#3b82f6',
  other:         '#94a3b8',
};

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

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.error = '';
    this.api.getRecurring().subscribe({
      next: (data) => { this.items = data; this.loading = false; },
      error: () => { this.error = 'Failed to load recurring transactions.'; this.loading = false; },
    });
  }

  get totalMonthlyIncome(): number {
    return this.items.filter(r => r.isIncome).reduce((s, r) => s + r.amount, 0);
  }

  get totalMonthlyExpense(): number {
    return this.items.filter(r => !r.isIncome).reduce((s, r) => s + r.amount, 0);
  }

  categoryIcon(cat: string): string {
    return CATEGORY_ICONS[cat] ?? CATEGORY_ICONS['other'];
  }

  categoryColor(cat: string): string {
    return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS['other'];
  }

  scheduleLabel(day: number): string {
    const s = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    return `Every ${day}${s}`;
  }

  trackById(_: number, r: RecurringEntry) { return r.id; }
}
