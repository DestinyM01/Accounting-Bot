import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Transaction, TransactionPage } from '../../core/services/api.models';

const CATEGORIES = ['food','transport','housing','health','entertainment','salary','savings','other'];

const CAT_COLORS: Record<string, string> = {
  housing:'#38bdf8', food:'#10e5a0', transport:'#fb923c',
  health:'#a78bfa', entertainment:'#f472b6', salary:'#10e5a0',
  savings:'#34d399', other:'#94a3b8',
};

const CAT_ICONS: Record<string, string> = {
  housing:'home', food:'restaurant', transport:'directions_car',
  health:'medical_services', entertainment:'movie', salary:'payments',
  savings:'savings', other:'receipt_long',
};

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, TitleCasePipe, FormsModule,
            MatIconModule, MatSelectModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
})
export class TransactionsComponent implements OnInit {
  items: Transaction[] = [];
  total = 0;
  offset = 0;
  limit = 20;
  loading = true;
  loadingMore = false;

  search = '';
  categoryFilter = '';
  categories = CATEGORIES;

  private search$ = new Subject<string>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.offset = 0; this.load(false); });
    this.load(false);
  }

  load(append: boolean) {
    if (append) this.loadingMore = true;
    else this.loading = true;

    this.api.getTransactions({
      limit: this.limit,
      offset: this.offset,
      category: this.categoryFilter || undefined,
    }).subscribe({
      next: (page: TransactionPage) => {
        this.items  = append ? [...this.items, ...page.items] : page.items;
        this.total  = page.total;
        this.loading = this.loadingMore = false;
      },
      error: () => { this.loading = this.loadingMore = false; },
    });
  }

  onSearch()         { this.search$.next(this.search); }
  onCategoryChange() { this.offset = 0; this.load(false); }

  loadMore() { this.offset += this.limit; this.load(true); }

  get hasMore() { return this.offset + this.limit < this.total; }

  // Apply client-side search filter (API doesn't support text search)
  get filtered(): Transaction[] {
    if (!this.search.trim()) return this.items;
    const q = this.search.toLowerCase();
    return this.items.filter(t =>
      t.transactionName.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }

  catColor(cat: string) { return CAT_COLORS[cat.toLowerCase()] ?? '#64748b'; }
  catIcon(cat: string)  { return CAT_ICONS[cat.toLowerCase()]  ?? 'category'; }
}
