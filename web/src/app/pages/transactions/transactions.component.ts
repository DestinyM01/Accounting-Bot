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
import { focusFirst } from '../../core/ui/focus';
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
  nextCursor: string | null = null;
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
  /** Rows with a category PATCH in flight, so each review row is independent of the others. */
  reviewing = new Set<string>();
  filedNote = '';

  private search$ = new Subject<string>();
  private searchSub!: Subscription;
  private eventsSub!: Subscription;

  /**
   * Bumped by a fresh load (never by "load more"), the same pattern as the
   * Balance page: a reply that started under an older generation is stale
   * (superseded by a filter change, another fresh load, or an in-place
   * reload) and is ignored, whether it succeeds or errors.
   */
  private generation = 0;

  constructor(
    private api: ApiService,
    private catSvc: CategoryService,
    private events: TransactionEventsService,
    private formSvc: TransactionFormService,
  ) {}

  ngOnInit() {
    this.searchSub = this.search$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.load(false));
    this.eventsSub = this.events.changed$.subscribe(() => this.reloadInPlace());
    // The category list is loaded once at app start; refresh it so a category
    // created elsewhere since then isn't shown as a deleted guess (isDeletedGuess).
    this.catSvc.load();
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
    let gen = this.generation;
    if (append) {
      this.loadingMore = true;
    } else {
      this.loading = true;
      // Clear before the request goes out, not after it comes back: a stale
      // "load more" in flight must not append past a cursor that no longer
      // matches this (possibly re-filtered) fresh load.
      this.nextCursor = null;
      gen = ++this.generation;
    }
    this.filedNote = '';

    this.api.getTransactions({
      limit:  this.limit,
      before: append ? this.nextCursor ?? undefined : undefined,
      ...this.currentFilters(),
    }).subscribe({
      next: (page: TransactionPage) => {
        if (gen !== this.generation) return;
        this.items      = append ? [...this.items, ...page.items] : page.items;
        this.total      = page.total;
        this.nextCursor = page.nextCursor;
        this.loading    = this.loadingMore = false;
        this.error      = null;
        this.dropPanelIfGone();
      },
      error: () => {
        if (gen !== this.generation) return;
        this.loading = this.loadingMore = false;
        this.error = 'Could not load transactions — reload the page.';
      },
    });
  }

  /**
   * Re-fetch what is on screen without the blocking "Loading…" state, keeping
   * scroll position, paged rows and the focused element. Cap at the API's max.
   * Bumps the generation too, so a "load more" already in flight cannot
   * append its (now stale) page onto this fresher one.
   */
  private reloadInPlace() {
    const count = Math.min(Math.max(this.items.length, this.limit), 200);
    const gen = ++this.generation;
    this.api.getTransactions({ ...this.currentFilters(), limit: count }).subscribe({
      next: (page: TransactionPage) => {
        if (gen !== this.generation) return;
        this.items      = page.items;
        this.total      = page.total;
        this.nextCursor = page.nextCursor;
        this.error      = null;
        this.dropPanelIfGone();
      },
      error: () => {
        if (gen !== this.generation) return;
        this.error = 'Could not refresh the list — reload the page.';
      },
    });
  }

  onSearch()         { this.search$.next(this.search); }
  onCategoryChange() { this.load(false); }
  onTypeChange()     { this.load(false); }
  onDateChange()     { this.load(false); }

  onNeedsReviewToggle() {
    this.needsReviewOnly = !this.needsReviewOnly;
    this.load(false);
  }

  onUnitemizedToggle() {
    this.unitemizedOnly = !this.unitemizedOnly;
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
    focusFirst(ids);
  }

  /** A guess naming a category deleted since: it can't be confirmed, only replaced. Unknown until the list has loaded. */
  isDeletedGuess(category: string): boolean {
    return this.catSvc.loaded && !this.categories.includes(category);
  }

  /** Rows whose dropdown is being moved through with the keyboard: their change waits for Enter or blur. */
  private readonly keyPicking = new Set<string>();

  /** Keys that move a closed dropdown's value (on Windows each one fires `change`). */
  private static readonly PICK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

  onPickKey(tx: Transaction, e: KeyboardEvent, select: HTMLSelectElement) {
    // On Windows, typing a letter on a closed select also jumps it to the
    // matching option and fires `change` immediately — the same "wait for
    // Enter/blur" treatment the arrow/paging keys get above. A plain
    // single-character key (no modifier) is a type-ahead pick; Ctrl/Meta/Alt
    // combos (shortcuts, not type-ahead) are excluded.
    const isTypeAheadPick = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (TransactionsComponent.PICK_KEYS.has(e.key) || isTypeAheadPick) {
      this.keyPicking.add(tx._id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.keyPicking.delete(tx._id);
      if (select.value) this.assignCategory(tx, select.value, select);
      return;
    }
    if (e.key === 'Escape') {
      this.keyPicking.delete(tx._id);
      select.value = this.isDeletedGuess(tx.category) ? '' : tx.category;
    }
  }

  /** A pointer choice files at once; a keyboard one waits (see onPickKey / onPickBlur). */
  onPickChange(tx: Transaction, select: HTMLSelectElement) {
    if (this.keyPicking.has(tx._id)) return;
    this.assignCategory(tx, select.value, select);
  }

  /** Leaving a dropdown after moving through it with the keyboard files the choice, if it differs from the guess. */
  onPickBlur(tx: Transaction, select: HTMLSelectElement) {
    if (!this.keyPicking.delete(tx._id)) return;
    if (select.value && select.value !== tx.category) this.assignCategory(tx, select.value, select);
  }

  /**
   * Sets one row's category. `select` is passed only by the review dropdown,
   * so a failed guess can be reset to what the row actually holds. Tracked in
   * `reviewing` rather than the shared `pendingId`, so one row's request in
   * flight never disables every other row still waiting for review.
   */
  assignCategory(tx: Transaction, category: string, select?: HTMLSelectElement) {
    if (!category || this.reviewing.has(tx._id)) return;
    this.reviewing.add(tx._id);
    this.filedNote = '';
    this.api.setTransactionCategory(tx._id, category).subscribe({
      next: ({ alsoFiled }) => {
        this.reviewing.delete(tx._id);
        tx.category = category;
        tx.categoryNeedsReview = false;
        if (alsoFiled > 0) {
          const merchant = (tx.merchant || tx.transactionName).toLowerCase().split(/[\s*#]+/).filter((t) => t && !/\d/.test(t)).join(' ');
          this.filedNote = `Also filed ${alsoFiled} other ${merchant} ${alsoFiled === 1 ? 'row' : 'rows'} as ${category}.`;
          this.events.notify(); // the other rows changed too: reload in place
        }
        // Move focus to the next row still waiting for review, so confirming
        // one guess after another needs no re-aiming at the list.
        const rows = this.filtered;
        const next = rows.slice(rows.indexOf(tx) + 1).find((t) => t.categoryNeedsReview);
        if (next) {
          setTimeout(() => (document.getElementById(`confirm-${next._id}`) ?? document.getElementById(`pick-${next._id}`))?.focus(), 0);
        }
      },
      error: () => {
        this.reviewing.delete(tx._id);
        if (select) select.value = this.isDeletedGuess(tx.category) ? '' : tx.category;
        alert('Failed to set category. Please try again.');
      },
    });
  }

  loadMore() { this.load(true); }

  get hasMore() { return this.nextCursor !== null; }

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
