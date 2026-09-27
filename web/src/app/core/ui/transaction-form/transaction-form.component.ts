import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationStart, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { CategoryService } from '../../services/category.service';
import { TransactionEventsService } from '../../services/transaction-events.service';
import { TransactionFormService, FormRequest } from '../../services/transaction-form.service';
import { Transaction } from '../../services/api.models';
import { IconComponent } from '../icon/icon.component';
import { rovingRadioKeydown } from '../roving-radio';

interface TypeOption { value: 'expense' | 'income'; label: string; icon: string; }

@Component({
    selector: 'app-transaction-form',
    imports: [CommonModule, FormsModule, IconComponent, TitleCasePipe],
    templateUrl: './transaction-form.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./transaction-form.component.scss']
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

  readonly typeOptions: TypeOption[] = [
    { value: 'expense', label: 'Expense', icon: 'arrow-down' },
    { value: 'income',  label: 'Income',  icon: 'arrow-up' },
  ];

  @ViewChild('firstField') firstField?: ElementRef<HTMLInputElement>;
  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;
  private sub?: Subscription;
  private navSub?: Subscription;
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
    private router: Router,
  ) {}

  get categories(): string[] { return this.catSvc.all.map(c => c.name); }
  get valid(): boolean { return !!this.amount && this.amount > 0 && !!this.name.trim() && !!this.category; }

  ngOnInit() {
    this.sub = this.formSvc.requests$.subscribe(r => this.show(r));
    // Browser Back (or any other navigation) while the form is open must close it: left
    // open, its body-scroll lock (see show()) would outlive the page that granted it, and
    // AppComponent's own NavigationStart handler no longer clears body overflow itself
    // unless the phone sheet was the thing open, precisely so it doesn't clobber this lock.
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe(() => { if (this.open) this.dismiss(); });
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.navSub?.unsubscribe();
  }

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
      this.date     = TransactionFormComponent.localDateKey(new Date().toISOString());
    }
    this.open = true;
    // Same body-scroll-lock approach as the phone nav sheet (AppComponent.toggleSheet):
    // a direct style assignment, restored on close.
    document.body.style.overflow = 'hidden';
    setTimeout(() => this.firstField?.nativeElement.focus(), 0);
  }

  close() {
    this.open = false;
    this.saving = false;
    document.body.style.overflow = '';
    setTimeout(() => this.trigger?.focus(), 0);
  }

  /** Cancel button, backdrop click and Escape all dismiss the form this way —
   *  ignored mid-save so a request that completes after the user dismisses
   *  can't close a form they've since reopened. */
  dismiss() {
    if (this.saving) return;
    this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.open) this.dismiss(); }

  // ── Type: a .seg radiogroup with arrow-key roving (same pattern as
  // Settings → Appearance and the Transactions type filter). ───────────────
  typeOptionId(option: TypeOption): string { return `tf-type-${option.value}`; }
  typeTabIndex(option: TypeOption): number { return option.value === this.type ? 0 : -1; }

  selectType(value: 'expense' | 'income') { this.type = value; }

  onTypeKeydown(event: KeyboardEvent, index: number) {
    rovingRadioKeydown(
      event, index, this.typeOptions.length,
      (i) => this.selectType(this.typeOptions[i].value),
      (i) => this.typeOptionId(this.typeOptions[i]),
    );
  }

  // ── Focus trap: Tab/Shift+Tab cycle within the panel while it's open,
  // same approach as AppComponent.onSheetKeydown for the phone nav sheet. ──
  onPanelKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const panel = this.panelRef?.nativeElement;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

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
