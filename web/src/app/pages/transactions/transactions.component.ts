import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, Subject, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CashBreakdown, Transaction, TransactionPage } from '../../core/services/api.models';
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
  error: string | null = null;

  search         = '';
  categoryFilter = '';
  typeFilter:    '' | 'income' | 'expense' = '';
  startDate      = '';
  endDate        = '';
  needsReviewOnly = false;
  unitemizedOnly  = false;

  /** The withdrawal whose itemize panel is open (one at a time), its breakdown and the add form. */
  cashFor: string | null = null;
  cash: CashBreakdown | null = null;
  cashLoading = false;
  cashBusy    = false;
  cashError   = '';
  itemCategory    = '';
  itemAmount: number | null = null;
  itemDescription = '';
  private cashGen = 0;

  get categories(): string[] { return this.catSvc.all.map(c => c.name); }

  confirmingDelete: string | null = null;
  pendingId: string | null = null;

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

  get itemCategories(): string[] { return this.categories.filter((c) => c !== 'cash'); }

  /** Cash of this withdrawal not yet itemized, from the list's counter. */
  unitemized(tx: Transaction): number {
    if (!tx.isWithdrawal || !tx.isExpense) return 0;
    return Math.max(0, Math.round((tx.amount - (tx.allocatedCash ?? 0)) * 100) / 100);
  }

  get canAddItem(): boolean {
    const a = this.itemAmount;
    return !!this.cash && !this.cashBusy && !!this.itemCategory
      && typeof a === 'number' && a > 0 && a <= this.cash.remaining + 0.005;
  }

  toggleCash(tx: Transaction) {
    if (this.cashFor === tx._id) {
      this.cashFor = null;
      this.cash = null;
      this.focusSoon(`itemize-${tx._id}`);
      return;
    }
    this.cashFor = tx._id;
    this.cash = null;
    this.cashError = '';
    this.resetItemForm();
    this.loadCash(tx, () => this.focusSoon('cash-category', `itemize-${tx._id}`));
  }

  addItem(tx: Transaction) {
    if (!this.canAddItem) return;
    this.cashBusy = true;
    this.cashError = '';
    const description = this.itemDescription.trim();
    this.api.addCashItem(tx._id, {
      category: this.itemCategory,
      amount: this.itemAmount!,
      ...(description ? { description } : {}),
    }).subscribe({
      next: () => {
        this.cashBusy = false;
        this.resetItemForm();
        this.loadCash(tx, () => this.focusSoon('cash-category', `itemize-${tx._id}`));
      },
      error: (e: HttpErrorResponse) => {
        this.cashBusy = false;
        this.cashError = this.cashMessage(e, "Couldn't add the item. Please try again.");
        this.loadCash(tx); // another tab may have itemized meanwhile: show what's really left
      },
    });
  }

  removeItem(tx: Transaction, index: number) {
    const items = this.cash?.items ?? [];
    const item = items[index];
    if (!item || this.cashBusy) return;
    const nextId = items[index + 1]?.id;
    this.cashBusy = true;
    this.cashError = '';
    this.api.deleteCashItem(item.id).subscribe({
      next: () => {
        this.cashBusy = false;
        this.loadCash(tx, () => this.focusSoon(...(nextId ? [`remove-${nextId}`] : []), 'cash-category', `itemize-${tx._id}`));
      },
      error: (e: HttpErrorResponse) => {
        this.cashBusy = false;
        this.cashError = this.cashMessage(e, "Couldn't remove the item. Please try again.");
        this.loadCash(tx);
      },
    });
  }

  /**
   * Loads the open panel's breakdown and updates the row's counter from it.
   * The generation check drops a reply for a panel that was closed or reloaded since.
   */
  private loadCash(tx: Transaction, then?: () => void) {
    const gen = ++this.cashGen;
    this.cashLoading = true;
    this.api.getCashBreakdown(tx._id).subscribe({
      next: (b) => {
        if (gen !== this.cashGen || this.cashFor !== tx._id) return;
        this.cash = b;
        this.cashLoading = false;
        tx.allocatedCash = b.allocated;
        then?.();
      },
      error: (e: HttpErrorResponse) => {
        if (gen !== this.cashGen || this.cashFor !== tx._id) return;
        this.cashLoading = false;
        this.cashError = this.cashMessage(e, "Couldn't load this withdrawal's items.");
      },
    });
  }

  /** A reload (filters, another tab, an edit) may drop the row whose panel is open: close the panel with it. */
  private dropPanelIfGone() {
    if (this.cashFor && !this.items.some((t) => t._id === this.cashFor)) {
      this.cashFor = null;
      this.cash = null;
    }
  }

  private resetItemForm() {
    this.itemCategory = '';
    this.itemAmount = null;
    this.itemDescription = '';
  }

  private cashMessage(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
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
