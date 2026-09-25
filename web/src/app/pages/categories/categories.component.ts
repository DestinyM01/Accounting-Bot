import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Observable, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryService } from '../../core/services/category.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import {
  CategoryInput,
  CategoryOverview,
  CategoryOverviewItem,
  CategoryUsage,
} from '../../core/services/api.models';

/** Same rule as api/src/categories/category-rules.ts; the server stays the authority. */
const NAME_RULE = /^[\p{Ll}0-9-]{1,20}$/u;

type Mode =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string };

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './categories.component.html',
  styleUrls: ['./categories.component.scss'],
})
export class CategoriesComponent implements OnInit, OnDestroy {
  @ViewChild('firstField') firstField?: ElementRef<HTMLElement>;

  overview: CategoryOverview | null = null;
  loading = true;
  loadError = '';

  mode: Mode = { kind: 'none' };
  name = '';
  emoji = '';
  color = '';
  moveTo = '';
  busy = false;
  actionError = '';
  finishError: { id: string; message: string } | null = null;

  private gen = 0;
  private destroyed = false;
  private readonly subs = new Subscription();

  constructor(
    private api: ApiService,
    private categorySvc: CategoryService,
    private events: TransactionEventsService,
  ) {}

  ngOnInit(): void {
    // Any write anywhere (this page, the + button, a row action) can change the usage counts.
    this.subs.add(this.events.changed$.subscribe(() => this.load()));
    this.load();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  get builtIns(): CategoryOverviewItem[] {
    return this.overview?.categories.filter((c) => c.isBuiltIn) ?? [];
  }

  get custom(): CategoryOverviewItem[] {
    return this.overview?.categories.filter((c) => !c.isBuiltIn) ?? [];
  }

  get editing(): CategoryOverviewItem | null {
    const m = this.mode;
    return m.kind === 'edit' ? this.custom.find((c) => c.id === m.id) ?? null : null;
  }

  get normalizedName(): string {
    return this.name.trim().toLowerCase();
  }

  get nameCheck(): string {
    const n = this.normalizedName;
    if (!n || n === this.editing?.name) return '';
    if (!NAME_RULE.test(n)) return 'Use 1–20 lowercase letters, digits or hyphens.';
    if (this.builtIns.some((c) => c.name === n)) return `${n} is a built-in category.`;
    return '';
  }

  get canSave(): boolean {
    if (this.busy || !this.normalizedName || this.nameCheck) return false;
    if (this.mode.kind === 'edit') return Object.keys(this.changes()).length > 0;
    return !!this.emoji && !!this.color;
  }

  get renameNote(): string {
    const c = this.editing;
    if (!c || this.normalizedName === c.name || !this.inUse(c)) return '';
    return `Renames it on ${this.usageSentence(c.usage)}.`;
  }

  inUse(c: CategoryOverviewItem): boolean {
    return c.usage.transactions + c.usage.recurring + c.usage.budgets > 0;
  }

  moveTargets(c: CategoryOverviewItem): CategoryOverviewItem[] {
    return (this.overview?.categories ?? []).filter((x) => x.active && !x.pending && x.name !== c.name);
  }

  /** A category an unfinished move is still moving data into can't be changed until that move finishes. */
  receivingMove(c: CategoryOverviewItem): boolean {
    return this.custom.some((x) => x.pending?.to === c.name);
  }

  usageText(u: CategoryUsage): string {
    const parts = this.usageParts(u);
    return parts.length > 0 ? parts.join(' · ') : 'Not used yet';
  }

  usageSentence(u: CategoryUsage): string {
    const parts = this.usageParts(u);
    return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  openCreate(): void {
    this.name = '';
    this.emoji = '';
    this.color = '';
    this.open({ kind: 'create' });
  }

  openEdit(c: CategoryOverviewItem): void {
    this.name = c.name;
    this.emoji = c.emoji;
    this.color = c.color;
    this.open({ kind: 'edit', id: c.id! });
  }

  openDelete(c: CategoryOverviewItem): void {
    this.moveTo = '';
    this.open({ kind: 'delete', id: c.id! });
  }

  close(): void {
    if (this.busy) return;
    const m = this.mode;
    this.mode = { kind: 'none' };
    this.actionError = '';
    this.focus(m.kind === 'edit' || m.kind === 'delete' ? `${m.kind}-${m.id}` : 'new-category');
  }

  save(): void {
    if (!this.canSave) return;
    const m = this.mode;
    if (m.kind === 'edit') {
      this.run(this.api.updateCategory(m.id, this.changes()), [`edit-${m.id}`]);
    } else {
      this.run(
        this.api.createCategory({ name: this.normalizedName, emoji: this.emoji, color: this.color }),
        ['new-category'],
      );
    }
  }

  confirmDelete(c: CategoryOverviewItem): void {
    if (this.busy || (this.inUse(c) && !this.moveTo)) return;
    this.run(this.api.deleteCategory(c.id!, this.inUse(c) ? this.moveTo : undefined), ['new-category']);
  }

  finish(c: CategoryOverviewItem): void {
    if (this.busy) return;
    this.busy = true;
    this.finishError = null;
    this.subs.add(
      this.api.finishCategoryMove(c.id!).subscribe({
        next: () => {
          this.busy = false;
          this.afterChange([`edit-${c.id}`, 'new-category']);
        },
        error: (e: HttpErrorResponse) => {
          this.busy = false;
          this.finishError = { id: c.id!, message: this.message(e) };
        },
      }),
    );
  }

  private usageParts(u: CategoryUsage): string[] {
    const parts: string[] = [];
    const add = (n: number, one: string, many: string) => {
      if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
    };
    add(u.transactions, 'transaction', 'transactions');
    add(u.recurring, 'recurring rule', 'recurring rules');
    add(u.budgets, 'budget', 'budgets');
    return parts;
  }

  private open(mode: Mode): void {
    this.mode = mode;
    this.actionError = '';
    this.finishError = null;
    setTimeout(() => {
      if (!this.destroyed) this.firstField?.nativeElement.focus();
    }, 0);
  }

  /** Only the fields that differ from the category being edited. */
  private changes(): CategoryInput {
    const c = this.editing;
    if (!c) return {};
    const out: CategoryInput = {};
    if (this.normalizedName !== c.name) out.name = this.normalizedName;
    if (this.emoji !== c.emoji) out.emoji = this.emoji;
    if (this.color !== c.color) out.color = this.color;
    return out;
  }

  private run(request: Observable<unknown>, focusIds: string[]): void {
    this.busy = true;
    this.actionError = '';
    this.subs.add(
      request.subscribe({
        next: () => {
          this.busy = false;
          this.mode = { kind: 'none' };
          this.afterChange(focusIds);
        },
        error: (e: HttpErrorResponse) => {
          this.busy = false;
          this.actionError = this.message(e);
          // A 500 may mean a move stopped halfway: reload so its Finish move shows,
          // and refresh the app's pickers in case a rename already took effect.
          this.load();
          this.categorySvc.load();
        },
      }),
    );
  }

  /** Every picker in the app follows (CategoryService); every list reloads, this page included (changed$). */
  private afterChange(focusIds: string[]): void {
    this.categorySvc.load();
    this.events.notify();
    this.focus(...focusIds);
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]): void {
    setTimeout(() => {
      if (this.destroyed) return;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          return;
        }
      }
    }, 0);
  }

  private message(e: HttpErrorResponse): string {
    return typeof e.error?.message === 'string' ? e.error.message : 'Something went wrong. Please try again.';
  }

  private load(): void {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getCategoryOverview().subscribe({
        next: (o) => {
          if (gen !== this.gen) return; // a newer request owns the page
          this.overview = o;
          // If the category being edited or deleted is now mid-move, close its form and
          // show the error beside its Finish move button instead.
          const m = this.mode;
          if ((m.kind === 'edit' || m.kind === 'delete') && o.categories.some((c) => c.id === m.id && c.pending)) {
            this.finishError = { id: m.id, message: this.actionError || "The move didn't finish." };
            this.mode = { kind: 'none' };
            this.actionError = '';
          }
          this.loadError = '';
          this.loading = false;
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loadError = "Couldn't load your categories.";
          this.loading = false;
        },
      }),
    );
  }
}
