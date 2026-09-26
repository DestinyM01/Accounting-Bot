import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { CashBreakdown, Transaction } from '../../../core/services/api.models';
import { CategoryService } from '../../../core/services/category.service';

/**
 * Itemizes one withdrawal: what its cash went to, and what's left. Each open
 * panel owns its state and its requests; closing it (destroying it) drops the
 * breakdown load if one is still in flight. An add or remove already sent keeps
 * going, though, and still updates the row's "not itemized" figure when it lands.
 * That in-flight reply has no generation guard against the list itself: if it
 * lands after a list reload (a fresh `tx` object) or after the panel is closed
 * and reopened for the same row, it can be lost or counted twice in the row's
 * figure until the next reload corrects it (accepted edge).
 */
@Component({
    selector: 'app-cash-panel',
    imports: [CurrencyPipe, TitleCasePipe, FormsModule, MatIconModule],
    templateUrl: './cash-panel.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./cash-panel.component.scss']
})
export class CashPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) tx!: Transaction;

  cash: CashBreakdown | null = null;
  loading = false;
  busy = false;
  error = '';
  category = '';
  amount: number | null = null;
  description = '';

  private gen = 0;
  private destroyed = false;
  private readonly subs = new Subscription();

  constructor(
    private readonly api: ApiService,
    private readonly catSvc: CategoryService,
  ) {}

  ngOnInit() {
    this.load(() => this.focus(this.ids.category, this.ids.itemize));
  }

  /** The list reloads rows as new objects (after an edit, say): reread the breakdown so "of $X" follows it. */
  ngOnChanges(changes: SimpleChanges) {
    if (changes['tx'] && !changes['tx'].firstChange) this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  get ids() {
    const id = this.tx._id;
    return { category: `cash-category-${id}`, amount: `cash-amount-${id}`, itemize: `itemize-${id}` };
  }

  /** Where cash can go: every category but cash itself, which is what's left over. */
  get categories(): string[] {
    return this.catSvc.all.map((c) => c.name).filter((c) => c !== 'cash');
  }

  /** Whole cents only, at least one, and no more than what's left: exactly what the api accepts. */
  get canAdd(): boolean {
    const a = this.amount;
    if (!this.cash || this.busy || !this.category || typeof a !== 'number' || !Number.isFinite(a)) return false;
    const cents = Math.round(a * 100);
    return cents >= 1 && Math.abs(a * 100 - cents) < 1e-6 && cents <= Math.round(this.cash.remaining * 100);
  }

  catColor(category: string) { return this.catSvc.color(category); }

  removeLabel(item: { category: string; description: string | null; amount: number }, amountText: string | null): string {
    return `Remove ${item.category}${item.description ? ' (' + item.description + ')' : ''} ${amountText ?? ''}`.trim();
  }

  add() {
    if (!this.canAdd) return;
    this.busy = true;
    this.error = '';
    const description = this.description.trim();
    const amount = Math.round(this.amount! * 100) / 100;
    this.api.addCashItem(this.tx._id, {
      category: this.category,
      amount,
      ...(description ? { description } : {}),
    }).subscribe({
      next: () => {
        if (this.destroyed) {
          // The panel closed while saving: the item exists, so keep the row's line honest.
          this.tx.allocatedCash = Math.round(((this.tx.allocatedCash ?? 0) + amount) * 100) / 100;
          return;
        }
        this.busy = false;
        this.category = '';
        this.amount = null;
        this.description = '';
        this.load(() => this.focus(this.ids.category, this.ids.itemize));
      },
      error: (e: HttpErrorResponse) => {
        if (this.destroyed) return;
        this.busy = false;
        this.error = this.message(e, "Couldn't add the item. Please try again.");
        // The Add button was disabled while saving, so focus fell to the page.
        this.focus(this.ids.amount, this.ids.itemize);
        this.load(); // another tab may have itemized meanwhile: show what's really left
      },
    });
  }

  remove(index: number) {
    const items = this.cash?.items ?? [];
    const item = items[index];
    if (!item || this.busy) return;
    const nextId = items[index + 1]?.id;
    this.busy = true;
    this.error = '';
    this.api.deleteCashItem(item.id).subscribe({
      next: () => {
        if (this.destroyed) {
          this.tx.allocatedCash = Math.max(0, Math.round(((this.tx.allocatedCash ?? 0) - item.amount) * 100) / 100);
          return;
        }
        this.busy = false;
        this.load(() => this.focus(...(nextId ? [`remove-${nextId}`] : []), this.ids.category, this.ids.itemize));
      },
      error: (e: HttpErrorResponse) => {
        if (this.destroyed) return;
        this.busy = false;
        this.error = this.message(e, "Couldn't remove the item. Please try again.");
        this.focus(`remove-${item.id}`, this.ids.category, this.ids.itemize);
        this.load();
      },
    });
  }

  /**
   * Reads the breakdown. It also updates the row's `allocatedCash`, the same list
   * object the row renders, so the row's "not itemized" line follows.
   */
  private load(then?: () => void) {
    const gen = ++this.gen;
    this.loading = true;
    this.subs.add(
      this.api.getCashBreakdown(this.tx._id).subscribe({
        next: (b) => {
          if (gen !== this.gen) return; // a newer load owns the panel
          this.cash = b;
          this.loading = false;
          this.tx.allocatedCash = b.allocated;
          then?.();
        },
        error: (e: HttpErrorResponse) => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.error = this.message(e, "Couldn't load this withdrawal's items.");
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]) {
    setTimeout(() => {
      if (this.destroyed) return;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) { el.focus(); return; }
      }
    }, 0);
  }
}
