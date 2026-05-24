import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Transaction, TransactionPage } from '../../core/services/api.models';

const CATEGORIES = ['food','transport','housing','health','entertainment','salary','savings','other'];

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, TitleCasePipe, FormsModule,
    MatCardModule, MatButtonToggleModule, MatIconModule, MatButtonModule, MatSelectModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
})
export class TransactionsComponent implements OnInit {
  items: Transaction[] = [];
  total = 0;
  offset = 0;
  limit = 30;
  loading = true;

  typeFilter: 'all' | 'income' | 'expense' = 'all';
  categoryFilter = '';
  categories = CATEGORIES;

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getTransactions({
      limit: this.limit,
      offset: this.offset,
      type: this.typeFilter === 'all' ? undefined : this.typeFilter,
      category: this.categoryFilter || undefined,
    }).subscribe({
      next: (page: TransactionPage) => {
        this.items = page.items;
        this.total = page.total;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  onFilterChange() {
    this.offset = 0;
    this.load();
  }

  prevPage() { this.offset = Math.max(0, this.offset - this.limit); this.load(); }
  nextPage() { this.offset += this.limit; this.load(); }

  get hasPrev() { return this.offset > 0; }
  get hasNext() { return this.offset + this.limit < this.total; }
  get page() { return Math.floor(this.offset / this.limit) + 1; }
  get pages() { return Math.ceil(this.total / this.limit); }
}
