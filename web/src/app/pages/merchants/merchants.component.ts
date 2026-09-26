import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, formatDate, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Observable, Subject, Subscription, catchError, debounceTime, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryService } from '../../core/services/category.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import { focusFirst } from '../../core/ui/focus';
import { MerchantMatch, RememberedMerchant } from '../../core/services/api.models';

/** Same rule as the api: cash is only ATM cash, and other means "don't know". */
const NEVER_REMEMBERED = ['cash', 'other'];

type Mode =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'change'; id: string }
  | { kind: 'forget'; id: string };

/** The preview for one typed name; `match` is null when the check failed. */
interface Preview {
  name: string;
  match: MerchantMatch | null;
}

const title = (s: string) => new TitleCasePipe().transform(s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

@Component({
    selector: 'app-merchants',
    imports: [CommonModule, FormsModule, MatIconModule],
    templateUrl: './merchants.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./merchants.component.scss']
})
export class MerchantsComponent implements OnInit, OnDestroy {
  merchants: RememberedMerchant[] = [];
  /** What a merchant can be remembered under: the active categories without cash and other. */
  categories: string[] = [];
  loading = true;
  loadError = '';
  status = '';
  /** Where the status is anchored: a merchant id, or 'top'. See effectiveStatusAt for where it actually renders. */
  statusAt: string = 'top';
  filter = '';

  mode: Mode = { kind: 'none' };
  name = '';
  category = '';
  preview: Preview | null = null;
  busy = false;
  actionError = '';

  private readonly typed = new Subject<string>();
  private gen = 0;
  private destroyed = false;
  private formFocus = '';
  private focusAfterLoad: string[] | null = null;
  private readonly subs = new Subscription();

  constructor(
    private api: ApiService,
    private catSvc: CategoryService,
    private events: TransactionEventsService,
  ) {}

  ngOnInit(): void {
    // A ✓ on the Transactions page, or a category renamed or deleted, can change this list.
    this.subs.add(this.events.changed$.subscribe(() => this.load()));
    this.subs.add(
      this.typed
        .pipe(
          debounceTime(300),
          // switchMap drops a slower, earlier reply: only the latest name's preview lands.
          switchMap((name) =>
            this.api.matchMerchant(name).pipe(
              map((match): Preview => ({ name, match })),
              catchError(() => of<Preview>({ name, match: null })),
            ),
          ),
        )
        .subscribe((p) => {
          if (p.name === this.name) this.preview = p;
        }),
    );
    this.load();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  get shown(): RememberedMerchant[] {
    const f = this.filter.trim().toLowerCase();
    const mode = this.mode;
    return f
      ? this.merchants.filter((m) => m.key.includes(f) || ('id' in mode && mode.id === m.id))
      : this.merchants;
  }

  /**
   * Where the status actually renders. `statusAt` anchors it to the row that
   * changed, but a filter typed since (or the forgotten row's neighbour no
   * longer matching) can leave that row out of `shown` — anchoring to a row
   * nobody sees would drop the message silently, so it falls back to the top.
   */
  get effectiveStatusAt(): string {
    return this.statusAt === 'top' || this.shown.some((m) => m.id === this.statusAt) ? this.statusAt : 'top';
  }

  /** The live line under the name field: what the typed name would match. */
  get previewText(): string {
    if (!this.name.trim()) return '';
    const p = this.preview;
    if (!p || p.name !== this.name) return 'Checking…';
    if (!p.match) return "Couldn't check that name. Keep typing to try again.";
    const { key, rows, remembered } = p.match;
    if (!key) return "This name can't identify a merchant";
    if (remembered) return `Already remembered as ${title(remembered)}`;
    return `Matches as "${key}" · ${rows > 0 ? plural(rows, 'booked row', 'booked rows') : 'no booked rows yet'}`;
  }

  get canAdd(): boolean {
    const p = this.preview;
    const match = p && p.name === this.name ? p.match : null;
    return !this.busy && !!match?.key && !match.remembered && !!this.category;
  }

  /** "3 rows · learned Sep 25". */
  usageText(m: RememberedMerchant): string {
    const rows = plural(m.rows, 'row', 'rows');
    return m.updatedAt ? `${rows} · learned ${formatDate(m.updatedAt, 'MMM d', 'en-US')}` : rows;
  }

  onName(value: string): void {
    this.name = value;
    if (value.trim()) this.typed.next(value);
    else this.preview = null;
  }

  notUsedText(m: RememberedMerchant): string {
    return NEVER_REMEMBERED.includes(m.category)
      ? `Not used: ${title(m.category)} isn't remembered`
      : 'Not used: its category was deleted';
  }

  catColor(name: string): string {
    return this.catSvc.color(name);
  }

  openAdd(): void {
    this.name = '';
    this.category = '';
    this.preview = null;
    this.open({ kind: 'add' }, 'merchant-name');
  }

  openChange(m: RememberedMerchant): void {
    this.category = m.usable ? m.category : '';
    this.open({ kind: 'change', id: m.id }, `pick-${m.id}`);
  }

  openForget(m: RememberedMerchant): void {
    this.open({ kind: 'forget', id: m.id }, `confirm-forget-${m.id}`);
  }

  close(): void {
    if (this.busy) return;
    const m = this.mode;
    this.mode = { kind: 'none' };
    this.actionError = '';
    // Back to the button that opened the form.
    this.focus(m.kind === 'change' || m.kind === 'forget' ? `${m.kind}-${m.id}` : 'add-merchant');
  }

  add(): void {
    if (!this.canAdd) return;
    this.run(
      this.api.addMerchant(this.name, this.category),
      (r) => `Added ${r.key}` + (r.alsoFiled > 0 ? `; filed ${plural(r.alsoFiled, 'waiting row', 'waiting rows')}` : ''),
      ['add-merchant'],
      'top',
    );
  }

  saveChange(m: RememberedMerchant): void {
    const category = this.category;
    if (this.busy || !category || category === m.category) return;
    this.run(
      this.api.changeMerchant(m.id, category),
      (r) => {
        m.category = category;
        m.usable = true;
        return r.moved > 0 ? `Moved ${plural(r.moved, `${m.key} row`, `${m.key} rows`)} to ${title(category)}` : 'Saved';
      },
      [`change-${m.id}`, 'add-merchant'],
      m.id,
    );
  }

  forget(m: RememberedMerchant): void {
    if (this.busy) return;
    const list = this.shown;
    const i = list.findIndex((x) => x.id === m.id);
    // The row after slides into the forgotten one's position; with none, the
    // row before is the closest thing still on screen; with neither (the only
    // row left), there's no row to anchor to at all — the top of the page.
    const next = list[i + 1] ?? list[i - 1];
    this.run(
      this.api.forgetMerchant(m.id),
      () => {
        this.merchants = this.merchants.filter((x) => x.id !== m.id);
        return `Forgot ${m.key}`;
      },
      next ? [`change-${next.id}`, 'add-merchant'] : ['add-merchant'],
      next?.id ?? 'top',
    );
  }

  private open(mode: Mode, focusId: string): void {
    this.mode = mode;
    this.actionError = '';
    this.status = '';
    this.formFocus = focusId;
    this.focus(focusId);
  }

  private run<T>(request: Observable<T>, done: (reply: T) => string, focusIds: string[], anchor: string): void {
    this.busy = true;
    this.actionError = '';
    this.subs.add(
      request.subscribe({
        next: (reply) => {
          this.busy = false;
          this.mode = { kind: 'none' };
          this.status = done(reply);
          this.statusAt = anchor;
          this.focusAfterLoad = focusIds;
          this.events.notify(); // rows may have moved: every list reloads, this page included (changed$)
          this.focus(...focusIds);
        },
        error: (e: HttpErrorResponse) => {
          this.busy = false;
          this.actionError = this.message(e, 'Something went wrong. Please try again.');
          this.load(); // a 404 or 409 means this list is stale
          // An add can fail because the name got remembered elsewhere: re-check it so the preview (and Add) reflect that.
          if (this.mode.kind === 'add' && this.name.trim()) {
            this.preview = null;
            this.typed.next(this.name);
          }
          // The button that sent it was disabled while busy, so focus fell to the page: return it to the form.
          const back = this.formFocus;
          setTimeout(() => {
            if (!this.destroyed && document.activeElement === document.body) this.focus(back);
          }, 0);
        },
      }),
    );
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]): void {
    focusFirst(ids, () => !this.destroyed);
  }

  /** Like focus(), but only when focus was lost (the focused control was removed or disabled), never stealing it. */
  private restoreFocus(ids: string[]): void {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) this.focus(...ids);
    }, 0);
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  private load(): void {
    const gen = ++this.gen;
    this.subs.add(
      forkJoin([this.api.getMerchants(), this.api.getCategories()]).subscribe({
        next: ([merchants, cats]) => {
          if (gen !== this.gen) return; // a newer request owns the page
          this.merchants = merchants;
          // One entry per name: a legacy custom category may share a built-in's name.
          this.categories = cats
            .map((c) => c.name)
            .filter((n, i, all) => !NEVER_REMEMBERED.includes(n) && all.indexOf(n) === i);
          // A category picked before this reload (add or change form) may no longer exist (deleted in another tab).
          if (this.category && !this.categories.includes(this.category)) this.category = '';
          // The merchant being changed or forgotten may be gone (another tab forgot it).
          const m = this.mode;
          if ((m.kind === 'change' || m.kind === 'forget') && !this.busy && !merchants.some((x) => x.id === m.id)) {
            this.mode = { kind: 'none' };
            this.actionError = '';
            this.status = 'That merchant is no longer remembered.';
            this.statusAt = 'top';
            this.focusAfterLoad = ['add-merchant'];
          }
          this.loadError = '';
          this.loading = false;
          if (this.focusAfterLoad) {
            this.restoreFocus(this.focusAfterLoad);
            this.focusAfterLoad = null;
          }
        },
        error: (e: HttpErrorResponse) => {
          if (gen !== this.gen) return;
          this.loadError = this.message(e, "Couldn't load your merchants.");
          this.loading = false;
          this.focusAfterLoad = null;
        },
      }),
    );
  }
}
