import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../core/services/api.service';
import { BudgetEntry } from '../../core/services/api.models';

@Component({
  selector: 'app-budget',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, MatCardModule, MatProgressBarModule],
  templateUrl: './budget.component.html',
  styleUrls: ['./budget.component.scss'],
})
export class BudgetComponent implements OnInit {
  budgets: BudgetEntry[] = [];
  loading = true;
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getBudget(this.month, this.year).subscribe({
      next: (data) => { this.budgets = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  budgetColor(pct: number): 'primary' | 'accent' | 'warn' {
    if (pct >= 90) return 'warn';
    if (pct >= 70) return 'accent';
    return 'primary';
  }

  get monthLabel() {
    return new Date(this.year, this.month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
  }
}
