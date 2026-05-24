import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { BalanceSummary, BudgetEntry, MonthlySummary, Transaction } from '../../core/services/api.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, MatCardModule, MatProgressBarModule, MatIconModule, MatChipsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  balance: BalanceSummary | null = null;
  summary: MonthlySummary | null = null;
  recentTx: Transaction[] = [];
  budgets: BudgetEntry[] = [];
  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit() {
    forkJoin({
      balance: this.api.getBalance(),
      summary: this.api.getStatisticsSummary(),
      transactions: this.api.getTransactions({ limit: 5 }),
      budget: this.api.getBudget(),
    }).subscribe({
      next: (data) => {
        this.balance = data.balance;
        this.summary = data.summary;
        this.recentTx = data.transactions.items;
        this.budgets = data.budget;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  budgetColor(pct: number): 'primary' | 'accent' | 'warn' {
    if (pct >= 90) return 'warn';
    if (pct >= 70) return 'accent';
    return 'primary';
  }
}
