import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { BudgetEntry } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { focusFirst } from '../../core/ui/focus';
import { IconComponent } from '../../core/ui/icon/icon.component';

@Component({
    selector: 'app-budget',
    imports: [CommonModule, CurrencyPipe, TitleCasePipe, FormsModule, RouterLink, IconComponent],
    templateUrl: './budget.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./budget.component.scss']
})
export class BudgetComponent implements OnInit, OnDestroy {
  budgets: BudgetEntry[] = [];
  loading = true;
  loadError: string | null = null;
  month = new Date().getMonth() + 1;
  year  = new Date().getFullYear();

  showForm   = false;
  formCat    = 'food';
  formAmount: number | null = null;
  formError: string | null = null;
  saving     = false;
  private destroyed = false;

  get categories(): string[] { return this.catSvc.all.map(c => c.name); }

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
  }

  load() {
    this.loading = true;
    this.loadError = null;
    this.api.getBudget(this.month, this.year).subscribe({
      next: (data) => { this.budgets = data; this.loading = false; },
      error: () => { this.loading = false; this.loadError = "Couldn't load the budget."; },
    });
  }

  get monthLabel() {
    return new Date(this.year, this.month - 1, 1)
      .toLocaleString('en', { month: 'long', year: 'numeric' });
  }

  get totalLimit()   { return this.budgets.reduce((s, b) => s + b.limit, 0); }
  get totalSpent()   { return this.budgets.reduce((s, b) => s + b.spent, 0); }
  get totalPct()     { return this.totalLimit > 0 ? Math.round(this.totalSpent / this.totalLimit * 100) : 0; }
  get totalRemain()  { return this.totalLimit - this.totalSpent; }
  get spentScale()   { return Math.min(this.totalPct, 100) / 100; }

  /** Categories that have gone over their limit this month. */
  get overBudgets(): BudgetEntry[] { return this.budgets.filter(b => b.percentage > 100); }
  get worstOver(): BudgetEntry | null {
    if (!this.overBudgets.length) return null;
    return [...this.overBudgets].sort((a, b) => b.percentage - a.percentage)[0];
  }

  catColor(cat: string) { return this.catSvc.color(cat); }
  catIcon(cat: string)  { return this.catSvc.icon(cat);  }

  /** Category progress-bar fill, capped at 1 so an over-budget category doesn't overflow it. */
  catScale(b: BudgetEntry): number { return Math.min(b.percentage, 100) / 100; }
  isOver(b: BudgetEntry): boolean { return b.remaining < 0; }
  remainAmount(b: BudgetEntry): number { return Math.abs(b.remaining); }

  openForm(category?: string) {
    if (this.showForm) {
      // Already open: don't clobber whatever the user has half-filled in, just bring
      // focus back to the form (e.g. the dashed "Set a budget" tile or another card's
      // pencil was clicked while a different edit was already in progress).
      focusFirst(['bud-cat'], () => !this.destroyed);
      return;
    }
    this.showForm = true;
    this.formError = null;
    if (category) {
      this.formCat = category;
      const existing = this.budgets.find(b => b.category === category);
      this.formAmount = existing ? existing.limit : null;
    } else {
      this.formCat = this.categories[0] ?? 'food';
      this.formAmount = null;
    }
    focusFirst(category ? ['bud-amount'] : ['bud-cat'], () => !this.destroyed);
  }

  closeForm() {
    this.showForm = false;
    this.formError = null;
    focusFirst(['bud-open'], () => !this.destroyed);
  }

  submitBudget() {
    if (!this.formAmount || this.formAmount <= 0) return;
    this.saving = true;
    this.formError = null;
    this.api.setBudget({
      category:    this.formCat,
      limitAmount: this.formAmount,
      month:       this.month,
      year:        this.year,
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.load();
        focusFirst(['bud-open'], () => !this.destroyed);
      },
      error: () => {
        this.saving = false;
        this.formError = "Couldn't save the budget.";
      },
    });
  }
}
