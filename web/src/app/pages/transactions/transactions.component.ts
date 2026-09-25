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
import { CashPanelComponent } from './cash-panel/cash-panel.component';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, TitleCasePipe, FormsModule,
            MatIconModule, MatSelectModule, CashPanelComponent],
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
  error: string | null = null;

  search         = '';
  categoryFilter = '';
  typeFilter:    '' | 'income' | 'expense' = '';
  startDate      = '';
  endDate        = '';
  needsReviewOnly = false;
  unitemizedOnly  = false;

  /** The withdrawal whose itemize panel is open (one at a time). The panel owns its own state. */
  cashFor: string | null = null;

  get categories(): string[] { return this.catSvc.all.map(c => c.name); }

  confirmingDelete: string | null = null;
  pendingId: string | null = null;
  filedNote = '';

  private search$ = new Subject<string>();
  private searchSub!: Subscription;
  private eventsSub!: Subscription;

  constructor(
    private api: ApiService,
    private catSvc: CategoryService,
    private events: TransactionEventsService,
    private formSvc: TransactionFormService,
  ) {}

  ngOnInit() {
    this.searchSub = this.search$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.offset = 0; this.load(false); });
    this.eventsSub = this.events.changed$.subscribe(() => this.reloadInPlace());
    this.load(false);
  }

  ngOnDestroy() {
    this.searchSub?.unsubscribe();
    this.eventsSub?.unsubscribe();
  }

  private currentFilters() {
    return {
      category:    this.categoryFilter || undefined,
      type:        (this.typeFilter as 'income' | 'expense') || undefined,
      startDate:   this.startDate || undefined,
      endDate:     this.endDate   || undefined,
      needsReview: this.needsReviewOnly || undefined,
      unitemized:  this.unitemizedOnly || undefined,
    };
  }

  load(append: boolean) {
    if (append) this.loadingMore = true;
    else        this.loading     = true;

    this.api.getTransactions({
      limit:  this.limit,
      offset: this.offset,
      ...this.currentFilters(),
    }).subscribe({
      next: (page: TransactionPage) => {
        this.items   = append ? [...this.items, ...page.items] : page.items;
        this.total   = page.total;
        this.loading = this.loadingMore = false;
        this.error   = null;
        this.dropPanelIfGone();
      },
      error: () => {
        this.loading = this.loadingMore = false;
        this.error = 'Could not load transactions — reload the page.';
      },
    });
  }

  /**
   * Re-fetch what is on screen without the blocking "Loading…" state, keeping
   * scroll position, paged rows and the focused element. Cap at the API's max.
   */
  private reloadInPlace() {
    const count = Math.min(Math.max(this.items.length, this.limit), 200);
    this.api.getTransactions({ ...this.currentFilters(), limit: count, offset: 0 }).subscribe({
      next: (page: TransactionPage) => {
        this.items  = page.items;
        this.total  = page.total;
        // Keep paging consistent: the next "Load More" continues after what is shown.
        this.offset = Math.max(0, page.items.length - this.limit);
        this.error  = null;
        this.dropPanelIfGone();
      },
      error: () => { this.error = 'Could not refresh the list — reload the page.'; },
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

  onUnitemizedToggle() {
    this.unitemizedOnly = !this.unitemizedOnly;
    this.offset = 0;
    this.load(false);
  }

  /** Cash of this withdrawal not yet itemized, from the list's counter. */
  unitemized(tx: Transaction): number {
    if (!tx.isWithdrawal || !tx.isExpense) return 0;
    return Math.max(0, Math.round((tx.amount - (tx.allocatedCash ?? 0)) * 100) / 100);
  }

  toggleCash(tx: Transaction) {
    const closing = this.cashFor === tx._id;
    this.cashFor = closing ? null : tx._id;
    if (closing) this.focusSoon(`itemize-${tx._id}`);
  }

  /** A reload (filters, another tab, an edit) may drop the row whose panel is open: close the panel with it. */
  private dropPanelIfGone() {
    if (this.cashFor && !this.items.some((t) => t._id === this.cashFor)) {
      this.cashFor = null;
    }
  }

  /** Focus the first of these elements that exists after the next render. */
  private focusSoon(...ids: string[]) {
    setTimeout(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) { el.focus(); return; }
      }
    }, 0);
  }

  assignCategory(tx: Transaction, category: string) {
    if (!category || this.pendingId) return;
    this.pendingId = tx._id;
    this.filedNote = '';
    this.api.setTransactionCategory(tx._id, category).subscribe({
      next: ({ alsoFiled }) => {
        this.pendingId = null;
        tx.category = category;
        tx.categoryNeedsReview = false;
        if (alsoFiled > 0) {
          this.filedNote = `Also filed ${alsoFiled} other ${tx.transactionName} ${alsoFiled === 1 ? 'row' : 'rows'} as ${category}.`;
          this.events.notify(); // the other rows changed too: reload in place
        }
      },
      error: () => {
        this.pendingId = null;
        alert('Failed to set category. Please try again.');
      },
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
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        a.download = `transactions-${localDate}.csv`;
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
  cancelDelete(btn?: HTMLElement) {
    this.confirmingDelete = null;
    btn?.focus();
  }
  confirmDelete(tx: Transaction) {
    if (this.pendingId) return;
    this.pendingId = tx._id;
    this.api.deleteTransaction(tx._id).subscribe({
      next: () => {
        this.pendingId = null;
        this.confirmingDelete = null;
        this.events.notify();
      },
      error: (e: { status?: number }) => {
        this.pendingId = null;
        this.confirmingDelete = null;
        alert(this.writeErrorMessage(e, 'Could not delete. Please try again.'));
        // A 404/409 means the row is stale (deleted or changed elsewhere) —
        // refresh the list so it stops showing a row that no longer matches.
        this.events.notify();
      },
    });
  }
  resolve(tx: Transaction, kind: 'internal' | 'external') {
    if (this.pendingId) return;
    this.pendingId = tx._id;
    this.api.resolveTransfer(tx._id, kind).subscribe({
      next: () => { this.pendingId = null; this.events.notify(); },
      error: (e: { status?: number }) => {
        this.pendingId = null;
        alert(this.writeErrorMessage(e, 'Could not resolve this transfer.'));
        this.events.notify();
      },
    });
  }
  private writeErrorMessage(e: { status?: number }, fallback: string): string {
    if (e?.status === 404) return 'That transaction no longer exists.';
    if (e?.status === 409) return 'It changed elsewhere — the list has been refreshed.';
    return fallback;
  }
  isTransfer(tx: Transaction) { return tx.transferKind === 'internal' || tx.transferKind === 'unresolved'; }
}
