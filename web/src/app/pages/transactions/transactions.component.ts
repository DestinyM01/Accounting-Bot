import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, Subject, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Transaction, TransactionPage } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import { TransactionFormService } from '../../core/services/transaction-form.service';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, TitleCasePipe, FormsModule,
            MatIconModule, MatSelectModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
})
export class TransactionsComponent implements OnInit, OnDestroy {
  items:       Transaction[] = [];
  total        = 0;
  offset       = 0;
  limit        = 20;
  loading      = true;
  loadingMore  = false;

  search         = '';
  categoryFilter = '';
  typeFilter:    '' | 'income' | 'expense' = '';
  startDate      = '';
  endDate        = '';
  needsReviewOnly = false;
  get categories(): string[] { return this.catSvc.all.map(c => c.name); }

  confirmingDelete: string | null = null;

  private search$ = new Subject<string>();
  private eventsSub!: Subscription;

  constructor(
    private api: ApiService,
    private catSvc: CategoryService,
    private events: TransactionEventsService,
    private formSvc: TransactionFormService,
  ) {}

  ngOnInit() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.offset = 0; this.load(false); });
    this.eventsSub = this.events.changed$.subscribe(() => { this.offset = 0; this.load(false); });
    this.load(false);
  }

  ngOnDestroy() {
    this.eventsSub?.unsubscribe();
  }

  load(append: boolean) {
    if (append) this.loadingMore = true;
    else        this.loading     = true;

    this.api.getTransactions({
      limit:       this.limit,
      offset:      this.offset,
      category:    this.categoryFilter || undefined,
      type:        (this.typeFilter as 'income' | 'expense') || undefined,
      startDate:   this.startDate || undefined,
      endDate:     this.endDate   || undefined,
      needsReview: this.needsReviewOnly || undefined,
    }).subscribe({
      next: (page: TransactionPage) => {
        this.items   = append ? [...this.items, ...page.items] : page.items;
        this.total   = page.total;
        this.loading = this.loadingMore = false;
      },
      error: () => { this.loading = this.loadingMore = false; },
    });
  }

  onSearch()         { this.search$.next(this.search); }
  onCategoryChange() { this.offset = 0; this.load(false); }
  onTypeChange()     { this.offset = 0; this.load(false); }
  onDateChange()     { this.offset = 0; this.load(false); }

  onNeedsReviewToggle() {
    this.needsReviewOnly = !this.needsReviewOnly;
    this.offset = 0;
    this.load(false);
  }

  assignCategory(tx: Transaction, category: string) {
    if (!category) return;
    this.api.setTransactionCategory(tx._id, category).subscribe({
      next: () => { tx.category = category; tx.categoryNeedsReview = false; },
      error: () => { alert('Failed to set category. Please try again.'); },
    });
  }

  loadMore() { this.offset += this.limit; this.load(true); }

  get hasMore() { return this.offset + this.limit < this.total; }

  get filtered(): Transaction[] {
    if (!this.search.trim()) return this.items;
    const q = this.search.toLowerCase();
    return this.items.filter(t =>
      t.transactionName.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }

  exportCsv() {
    this.api.exportTransactions({
      type:      (this.typeFilter as 'income' | 'expense') || undefined,
      category:  this.categoryFilter || undefined,
      startDate: this.startDate || undefined,
      endDate:   this.endDate   || undefined,
    }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {},
    });
  }

  catColor(cat: string) { return this.catSvc.color(cat); }
  catIcon(cat: string)  { return this.catSvc.icon(cat);  }

  edit(tx: Transaction)      { this.formSvc.openEdit(tx); }
  askDelete(tx: Transaction) { this.confirmingDelete = tx._id; }
  cancelDelete()             { this.confirmingDelete = null; }
  confirmDelete(tx: Transaction) {
    this.api.deleteTransaction(tx._id).subscribe({
      next: () => { this.confirmingDelete = null; this.events.notify(); },
      error: () => { this.confirmingDelete = null; alert('Could not delete. Please try again.'); },
    });
  }
  resolve(tx: Transaction, kind: 'internal' | 'external') {
    this.api.resolveTransfer(tx._id, kind).subscribe({
      next: () => this.events.notify(),
      error: () => alert('Could not resolve this transfer.'),
    });
  }
  isTransfer(tx: Transaction) { return tx.transferKind === 'internal' || tx.transferKind === 'unresolved'; }
}
