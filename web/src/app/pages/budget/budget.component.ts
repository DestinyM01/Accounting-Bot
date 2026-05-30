import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { BudgetEntry } from '../../core/services/api.models';

const CAT_COLORS: Record<string, string> = {
  housing:'#38bdf8', food:'#10e5a0', transport:'#fb923c',
  health:'#a78bfa', entertainment:'#f472b6', salary:'#10e5a0',
  groceries:'#10e5a0', shopping:'#f472b6', savings:'#34d399', other:'#94a3b8',
};

const CAT_ICONS: Record<string, string> = {
  housing:'home', food:'restaurant', groceries:'shopping_cart',
  transport:'directions_car', health:'medical_services',
  entertainment:'movie', shopping:'shopping_bag',
  salary:'payments', savings:'savings', other:'receipt_long',
};

@Component({
  selector: 'app-budget',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, FormsModule, MatIconModule],
  templateUrl: './budget.component.html',
  styleUrls: ['./budget.component.scss'],
})
export class BudgetComponent implements OnInit {
  budgets: BudgetEntry[] = [];
  loading = true;
  month = new Date().getMonth() + 1;
  year  = new Date().getFullYear();

  showForm   = false;
  formCat    = 'food';
  formAmount = 0;
  saving     = false;

  readonly categories = [
    'food', 'transport', 'housing', 'health',
    'entertainment', 'salary', 'savings', 'other',
  ];

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getBudget(this.month, this.year).subscribe({
      next: (data) => { this.budgets = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  get monthLabel() {
    return new Date(this.year, this.month - 1, 1)
      .toLocaleString('en', { month: 'long', year: 'numeric' });
  }

  get totalLimit()   { return this.budgets.reduce((s, b) => s + b.limit, 0); }
  get totalSpent()   { return this.budgets.reduce((s, b) => s + b.spent, 0); }
  get totalPct()     { return this.totalLimit > 0 ? Math.round(this.totalSpent / this.totalLimit * 100) : 0; }
  get totalRemain()  { return this.totalLimit - this.totalSpent; }

  get insightText(): string {
    if (!this.budgets.length) return '';
    const best = [...this.budgets].sort((a, b) => a.percentage - b.percentage)[0];
    const pct  = 100 - best.percentage;
    return `You are spending ${pct}% less than your ${best.category} budget this month.`;
  }

  get nearLimit(): BudgetEntry[] { return this.budgets.filter(b => b.percentage >= 80); }

  catColor(cat: string) { return CAT_COLORS[cat.toLowerCase()] ?? '#64748b'; }
  catIcon(cat: string)  { return CAT_ICONS[cat.toLowerCase()]  ?? 'category'; }

  budgetBarColor(pct: number): string {
    if (pct >= 90) return '#f87171';
    if (pct >= 70) return '#fb923c';
    return '#10e5a0';
  }

  openForm()  { this.showForm = true;  this.formCat = 'food'; this.formAmount = 0; }
  closeForm() { this.showForm = false; }

  submitBudget() {
    if (!this.formAmount || this.formAmount <= 0) return;
    this.saving = true;
    this.api.setBudget({
      category:    this.formCat,
      limitAmount: this.formAmount,
      month:       this.month,
      year:        this.year,
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.loading = true;
        this.api.getBudget(this.month, this.year).subscribe({
          next: (data) => { this.budgets = data; this.loading = false; },
          error: ()   => { this.loading = false; },
        });
      },
      error: () => { this.saving = false; },
    });
  }
}
