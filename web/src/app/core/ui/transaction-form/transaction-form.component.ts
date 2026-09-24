import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Observable, Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { CategoryService } from '../../services/category.service';
import { TransactionEventsService } from '../../services/transaction-events.service';
import { TransactionFormService, FormRequest } from '../../services/transaction-form.service';
import { Transaction } from '../../services/api.models';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, TitleCasePipe],
  templateUrl: './transaction-form.component.html',
  styleUrls: ['./transaction-form.component.scss'],
})
export class TransactionFormComponent implements OnInit, OnDestroy {
  open = false;
  mode: 'create' | 'edit' = 'create';
  editing: Transaction | null = null;

  type: 'income' | 'expense' = 'expense';
  amount: number | null = null;
  name = '';
  category = 'other';
  date = '';

  saving = false;
  error = '';

  @ViewChild('firstField') firstField?: ElementRef<HTMLInputElement>;
  private sub?: Subscription;
  private trigger: HTMLElement | null = null;

  /** Local YYYY-MM-DD for a stored ISO timestamp — the day the user actually saw. */
  private static localDateKey(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  private originalDate = '';

  constructor(
    private api: ApiService,
    private catSvc: CategoryService,
    private events: TransactionEventsService,
    private formSvc: TransactionFormService,
  ) {}

  get categories(): string[] { return this.catSvc.all.map(c => c.name); }
  get valid(): boolean { return !!this.amount && this.amount > 0 && !!this.name.trim() && !!this.category; }

  ngOnInit() {
    this.sub = this.formSvc.requests$.subscribe(r => this.show(r));
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  private show(r: FormRequest) {
    this.trigger = document.activeElement as HTMLElement | null;
    this.error = '';
    this.mode = r.mode;
    if (r.mode === 'edit') {
      this.editing  = r.tx;
      this.type     = r.tx.isExpense ? 'expense' : 'income';
      this.amount   = r.tx.amount;
      this.name     = r.tx.transactionName;
      this.category = r.tx.category;
      this.date     = TransactionFormComponent.localDateKey(r.tx.timestamp);
      this.originalDate = this.date;
    } else {
      this.editing  = null;
      this.type     = 'expense';
      this.amount   = null;
      this.name     = '';
      this.category = 'other';
      this.date     = new Date().toISOString().slice(0, 10);
    }
    this.open = true;
    setTimeout(() => this.firstField?.nativeElement.focus(), 0);
  }

  close() {
    this.open = false;
    this.saving = false;
    setTimeout(() => this.trigger?.focus(), 0);
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.open) this.close(); }

  save() {
    if (!this.valid || this.saving) return;
    this.saving = true;
    this.error = '';

    let timestamp: string | undefined;
    if (this.mode === 'edit' && this.editing) {
      // Send a timestamp ONLY if the user changed the date — and then keep the
      // original time-of-day, moving just the calendar day. Never rewrite the
      // time of a transaction the bank already stamped.
      if (this.date && this.date !== this.originalDate) {
        const orig = new Date(this.editing.timestamp);
        const [y, m, d] = this.date.split('-').map(Number);
        timestamp = new Date(y, m - 1, d, orig.getHours(), orig.getMinutes(), orig.getSeconds()).toISOString();
      }
    } else {
      // New transactions: noon local, so the picked day survives any timezone.
      timestamp = this.date ? new Date(this.date + 'T12:00:00').toISOString() : undefined;
    }

    // Typed as Observable<unknown>: create and update resolve to different
    // bodies ({ id } vs void) and neither is used below, but a union of the
    // two return types leaves `subscribe` with no single compatible overload.
    const req: Observable<unknown> = this.mode === 'edit' && this.editing
      ? this.api.updateTransaction(this.editing._id, { name: this.name, category: this.category, amount: this.amount!, ...(timestamp ? { timestamp } : {}) })
      : this.api.createTransaction({ type: this.type, amount: this.amount!, name: this.name, category: this.category, timestamp });

    req.subscribe({
      next: () => { this.events.notify(); this.close(); },
      error: (e: { status?: number; error?: { message?: string } }) => {
        this.saving = false;
        // Surface the API's own message. A 409 means the row changed elsewhere
        // (deleted, re-edited or resolved in another tab); the right action is
        // to reload it, not to retry blindly.
        this.error = e?.status === 409
          ? 'This transaction changed elsewhere. Close and reopen it to see the latest.'
          : (e?.error?.message ?? 'Could not save. Please try again.');
      },
    });
  }
}
