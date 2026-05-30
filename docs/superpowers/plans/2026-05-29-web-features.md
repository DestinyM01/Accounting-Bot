# Web Features — Budget Creation, Recurring Delete, Dashboard Auto-Refresh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable budget creation from the web dashboard, add delete for recurring transactions, and add 60-second auto-refresh to the dashboard.

**Architecture:** Two separate NestJS services live in this repo — `api/` (the web REST API, JWT-guarded) and `repo/` (the Telegram bot). This plan only touches `api/` and `web/`. Tasks B1→B2 are sequential (API before UI). Tasks B3→B4 are sequential. Task B5 is independent.

**Tech Stack:** NestJS (api/) · Angular 17 (web/) · Mongoose · RxJS · pnpm

---

## File map

| File | Task | Change |
|---|---|---|
| `api/src/budget/budget.service.ts` | B1 | Add `set(category, limitAmount, month?, year?)` — upsert logic |
| `api/src/budget/budget.controller.ts` | B1 | Add `POST /budget` endpoint |
| `web/src/app/core/services/api.models.ts` | B2 | Add `SetBudgetRequest` interface |
| `web/src/app/core/services/api.service.ts` | B2 | Add `setBudget()` method |
| `web/src/app/pages/budget/budget.component.ts` | B2 | Add inline form state + submit handler |
| `web/src/app/pages/budget/budget.component.html` | B2 | Replace disabled button with working form |
| `web/src/app/pages/budget/budget.component.scss` | B2 | Inline form styles |
| `api/src/recurring/recurring.service.ts` | B3 | Add `delete(id)` — soft delete |
| `api/src/recurring/recurring.controller.ts` | B3 | Add `DELETE /recurring/:id` endpoint |
| `web/src/app/core/services/api.service.ts` | B4 | Add `deleteRecurring()` method |
| `web/src/app/pages/recurring/recurring.component.ts` | B4 | Add `deleteItem()` method |
| `web/src/app/pages/recurring/recurring.component.html` | B4 | Add delete button per card |
| `web/src/app/pages/recurring/recurring.component.scss` | B4 | Delete button styles |
| `web/src/app/pages/dashboard/dashboard.component.ts` | B5 | Add 60-second polling interval |

---

## Task B1 — Budget API: add `POST /budget` endpoint

**Files:**
- Modify: `api/src/budget/budget.service.ts`
- Modify: `api/src/budget/budget.controller.ts`

**Context:** `api/src/shared/schemas/budget.schema.ts` uses `@Prop({ enum: Category })` — only the 8 existing categories are valid. The `userId` comes from `process.env.BOSS_USER_ID` (single-user app pattern). Month/year default to current if omitted.

- [ ] **Step 1: Add `set()` method to `BudgetService`**

  Find `api/src/budget/budget.service.ts`. After the `get()` method, add:

  ```typescript
  async set(category: string, limitAmount: number, month?: number, year?: number): Promise<void> {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    await this.budgetModel.findOneAndUpdate(
      { userId: this.userId, category, month: m, year: y },
      { limitAmount },
      { upsert: true },
    );
  }
  ```

  Full updated service file:

  ```typescript
  import { Injectable } from '@nestjs/common';
  import { InjectModel } from '@nestjs/mongoose';
  import { Model } from 'mongoose';
  import { Budget } from '../shared/schemas/budget.schema';
  import { Transaction } from '../shared/schemas/transaction.schema';

  @Injectable()
  export class BudgetService {
    private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

    constructor(
      @InjectModel(Budget.name) private budgetModel: Model<Budget>,
      @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    ) {}

    async get(month?: number, year?: number) {
      const now = new Date();
      const m = month ?? now.getMonth() + 1;
      const y = year ?? now.getFullYear();

      const budgets = await this.budgetModel
        .find({ userId: this.userId, month: m, year: y })
        .lean();

      if (!budgets.length) return [];

      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);

      const expenses = await this.transactionModel
        .find({ userId: this.userId, timestamp: { $gte: start, $lt: end }, amount: { $lt: 0 } })
        .select('category amount')
        .lean();

      return budgets.map((b) => {
        const spent = expenses
          .filter((t) => t.category === b.category)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        return {
          category: b.category,
          limit: b.limitAmount,
          spent: Math.round(spent * 100) / 100,
          remaining: Math.round((b.limitAmount - spent) * 100) / 100,
          percentage: Math.min(100, Math.round((spent / b.limitAmount) * 100)),
          month: m,
          year: y,
        };
      });
    }

    async set(category: string, limitAmount: number, month?: number, year?: number): Promise<void> {
      const now = new Date();
      const m = month ?? now.getMonth() + 1;
      const y = year ?? now.getFullYear();

      await this.budgetModel.findOneAndUpdate(
        { userId: this.userId, category, month: m, year: y },
        { limitAmount },
        { upsert: true },
      );
    }
  }
  ```

- [ ] **Step 2: Add `POST /budget` to the controller**

  Find `api/src/budget/budget.controller.ts`. Replace the entire file with:

  ```typescript
  import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
  import { JwtAuthGuard } from '../auth/jwt.guard';
  import { BudgetService } from './budget.service';

  @Controller('budget')
  @UseGuards(JwtAuthGuard)
  export class BudgetController {
    constructor(private readonly budgetService: BudgetService) {}

    @Get()
    get(@Query('month') month?: string, @Query('year') year?: string) {
      return this.budgetService.get(
        month ? parseInt(month, 10) : undefined,
        year ? parseInt(year, 10) : undefined,
      );
    }

    @Post()
    @HttpCode(204)
    async set(
      @Body() body: { category: string; limitAmount: number; month?: number; year?: number },
    ) {
      await this.budgetService.set(body.category, body.limitAmount, body.month, body.year);
    }
  }
  ```

- [ ] **Step 3: Build API to verify**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Found 0 errors.` or similar clean output.

- [ ] **Step 4: Commit**

  ```bash
  git add api/src/budget/budget.service.ts api/src/budget/budget.controller.ts
  git commit -m "feat(api/budget): add POST /budget endpoint for web budget creation"
  ```

---

## Task B2 — Budget UI: inline form to set category limits

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`
- Modify: `web/src/app/pages/budget/budget.component.ts`
- Modify: `web/src/app/pages/budget/budget.component.html`
- Modify: `web/src/app/pages/budget/budget.component.scss`

**Context:** The budget page currently has `<button class="new-budget-btn" disabled>`. We replace this with a toggleable inline form. The form shows a category select (the 8 fixed categories) + amount input + submit. On success, re-fetch budgets.

- [ ] **Step 1: Add `SetBudgetRequest` to `api.models.ts`**

  At the end of `web/src/app/core/services/api.models.ts`, add:

  ```typescript
  export interface SetBudgetRequest {
    category: string;
    limitAmount: number;
    month?: number;
    year?: number;
  }
  ```

- [ ] **Step 2: Add `setBudget()` to `ApiService`**

  In `web/src/app/core/services/api.service.ts`, add this method after `getBudget()`:

  ```typescript
  setBudget(body: SetBudgetRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/budget`, body);
  }
  ```

  Also add `SetBudgetRequest` to the import block at the top of that file.

- [ ] **Step 3: Update `BudgetComponent` TypeScript**

  In `web/src/app/pages/budget/budget.component.ts`:

  1. Add `FormsModule` to the imports array.
  2. Add these properties to the class:

  ```typescript
  showForm   = false;
  formCat    = 'food';
  formAmount = 0;
  saving     = false;

  readonly categories = [
    'food','transport','housing','health',
    'entertainment','salary','savings','other',
  ];
  ```

  3. Add this method to the class:

  ```typescript
  openForm() { this.showForm = true; this.formCat = 'food'; this.formAmount = 0; }
  closeForm() { this.showForm = false; }

  submitBudget() {
    if (!this.formAmount || this.formAmount <= 0) return;
    this.saving = true;
    this.api.setBudget({
      category:    this.formCat,
      limitAmount: this.formAmount,
      month:       this.month,
      year:        this.year,
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.loading = true;
        this.api.getBudget(this.month, this.year).subscribe({
          next: (data) => { this.budgets = data; this.loading = false; },
          error: ()   => { this.loading = false; },
        });
      },
      error: () => { this.saving = false; },
    });
  }
  ```

  Also add `FormsModule` to the component imports:
  ```typescript
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, MatIconModule, FormsModule],
  ```
  And add `FormsModule` to the TypeScript import at the top:
  ```typescript
  import { FormsModule } from '@angular/forms';
  ```

- [ ] **Step 4: Update `budget.component.html`**

  Find the header button:
  ```html
      <button class="new-budget-btn" disabled>
        <mat-icon>add</mat-icon> Set New Budget
      </button>
  ```

  Replace with:
  ```html
      <button class="new-budget-btn" (click)="openForm()" [disabled]="showForm">
        <mat-icon>add</mat-icon> Set New Budget
      </button>
  ```

  Then, directly after the closing `</div>` of `.page-header`, add the inline form:
  ```html
    @if (showForm) {
      <div class="budget-form-row card">
        <select class="bf-select" [(ngModel)]="formCat">
          @for (cat of categories; track cat) {
            <option [value]="cat">{{ cat | titlecase }}</option>
          }
        </select>
        <input  class="bf-input" type="number" min="1" [(ngModel)]="formAmount"
                placeholder="Monthly limit (USD)" />
        <button class="bf-submit" [disabled]="saving || formAmount <= 0" (click)="submitBudget()">
          <mat-icon>{{ saving ? 'hourglass_empty' : 'check' }}</mat-icon>
          {{ saving ? 'Saving…' : 'Set Limit' }}
        </button>
        <button class="bf-cancel" (click)="closeForm()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }
  ```

- [ ] **Step 5: Add form styles to `budget.component.scss`**

  Append to `web/src/app/pages/budget/budget.component.scss`:

  ```scss
  // ── Inline budget form ─────────────────────────────────────────────────
  .budget-form-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .bf-select,
  .bf-input {
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    font-size: 0.875rem;
    font-family: var(--font-body);
    padding: 9px 14px;
    outline: none;
    transition: border-color 0.15s;
    &:focus-visible { border-color: var(--color-accent); }
  }
  .bf-select { min-width: 140px; appearance: none; cursor: pointer; }
  .bf-input  { width: 200px; }

  .bf-submit {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 0.875rem;
    font-family: var(--font-body);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.13s;
    mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    &:disabled { opacity: 0.5; cursor: default; }
    &:not(:disabled):hover { opacity: 0.85; }
    &:not(:disabled):focus-visible { opacity: 0.85; outline: 2px solid var(--color-focus); outline-offset: 2px; }
  }

  .bf-cancel {
    display: flex;
    align-items: center;
    background: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-muted);
    padding: 9px 10px;
    cursor: pointer;
    transition: background 0.13s;
    mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
    &:hover { background: var(--color-surface-hover); }
    &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  }
  ```

- [ ] **Step 6: Build web to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 7: Commit**

  ```bash
  git add web/src/app/core/services/api.models.ts \
          web/src/app/core/services/api.service.ts \
          web/src/app/pages/budget/budget.component.ts \
          web/src/app/pages/budget/budget.component.html \
          web/src/app/pages/budget/budget.component.scss
  git commit -m "feat(web/budget): inline form to set category budget limits"
  ```

---

## Task B3 — Recurring API: add `DELETE /recurring/:id`

**Files:**
- Modify: `api/src/recurring/recurring.service.ts`
- Modify: `api/src/recurring/recurring.controller.ts`

**Context:** Soft-delete only (set `active: false`) — matches the existing pattern in the Telegram bot's RecurringService. The `id` is the MongoDB `_id` string.

- [ ] **Step 1: Add `delete()` method to `RecurringService`**

  Full updated `api/src/recurring/recurring.service.ts`:

  ```typescript
  import { Injectable } from '@nestjs/common';
  import { InjectModel } from '@nestjs/mongoose';
  import { Model } from 'mongoose';
  import { Recurring } from '../shared/schemas/recurring.schema';
  import { TransactionType } from '../shared/schemas/transaction-type.enum';

  @Injectable()
  export class RecurringService {
    private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

    constructor(@InjectModel(Recurring.name) private model: Model<Recurring>) {}

    async list() {
      const items = await this.model
        .find({ userId: this.userId, active: true })
        .sort({ dayOfMonth: 1 })
        .lean();

      return items.map((r) => ({
        id: (r as any)._id.toString(),
        transactionName: r.transactionName,
        isIncome: r.transactionType === TransactionType.INCOME,
        amount: r.amount,
        category: r.category,
        dayOfMonth: r.dayOfMonth,
        lastExecutedAt: r.lastExecutedAt ?? null,
      }));
    }

    async delete(id: string): Promise<void> {
      await this.model.findOneAndUpdate(
        { _id: id, userId: this.userId },
        { active: false },
      );
    }
  }
  ```

- [ ] **Step 2: Add `DELETE /recurring/:id` to the controller**

  Full updated `api/src/recurring/recurring.controller.ts`:

  ```typescript
  import { Controller, Delete, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
  import { JwtAuthGuard } from '../auth/jwt.guard';
  import { RecurringService } from './recurring.service';

  @Controller('recurring')
  @UseGuards(JwtAuthGuard)
  export class RecurringController {
    constructor(private readonly recurringService: RecurringService) {}

    @Get()
    list() {
      return this.recurringService.list();
    }

    @Delete(':id')
    @HttpCode(204)
    async delete(@Param('id') id: string) {
      await this.recurringService.delete(id);
    }
  }
  ```

- [ ] **Step 3: Build API to verify**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  ```
  Expected: clean build, no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add api/src/recurring/recurring.service.ts api/src/recurring/recurring.controller.ts
  git commit -m "feat(api/recurring): add DELETE /recurring/:id for web delete"
  ```

---

## Task B4 — Recurring UI: add delete button per card

**Files:**
- Modify: `web/src/app/core/services/api.service.ts`
- Modify: `web/src/app/pages/recurring/recurring.component.ts`
- Modify: `web/src/app/pages/recurring/recurring.component.html`
- Modify: `web/src/app/pages/recurring/recurring.component.scss`

**Context:** Add a delete icon button to each recurring card. On click, prompt `window.confirm()` — if confirmed, call `DELETE /recurring/:id`, then remove the item from the local list. No full reload needed.

- [ ] **Step 1: Add `deleteRecurring()` to `ApiService`**

  In `web/src/app/core/services/api.service.ts`, add after `getRecurring()`:

  ```typescript
  deleteRecurring(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/recurring/${id}`);
  }
  ```

- [ ] **Step 2: Add `deleteItem()` to `RecurringComponent`**

  In `web/src/app/pages/recurring/recurring.component.ts`, add to the class:

  ```typescript
  deleteItem(item: RecurringEntry) {
    const label = item.transactionName;
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    this.api.deleteRecurring(item.id).subscribe({
      next: () => { this.items = this.items.filter(r => r.id !== item.id); },
      error: () => { alert('Failed to delete. Please try again.'); },
    });
  }
  ```

- [ ] **Step 3: Add delete button to each recurring card in the HTML**

  In `web/src/app/pages/recurring/recurring.component.html`, find the recurring card header. Look for where `transactionName` or the card top-row is rendered. Add a delete button alongside the existing card header content.

  Find the element that displays the card name/icon row (likely a `.rp-card-header` or similar). Add the delete button inside that row:

  ```html
  <button class="rp-delete-btn"
          (click)="deleteItem(item)"
          [attr.aria-label]="'Delete ' + item.transactionName">
    <mat-icon>delete_outline</mat-icon>
  </button>
  ```

  Place it so it appears at the trailing edge of each card's top row. You will need to read the HTML to find the exact card structure before editing.

- [ ] **Step 4: Add delete button styles to `recurring.component.scss`**

  Append to `web/src/app/pages/recurring/recurring.component.scss`:

  ```scss
  // ── Delete button ──────────────────────────────────────────────────────
  .rp-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 4px;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.13s, color 0.13s;
    mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }

    &:hover { background: rgba(248,113,113,0.1); color: var(--expense); }
    &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  }
  ```

- [ ] **Step 5: Build web to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/app/core/services/api.service.ts \
          web/src/app/pages/recurring/recurring.component.ts \
          web/src/app/pages/recurring/recurring.component.html \
          web/src/app/pages/recurring/recurring.component.scss
  git commit -m "feat(web/recurring): add delete button per card"
  ```

---

## Task B5 — Dashboard auto-refresh every 60 seconds

**Files:**
- Modify: `web/src/app/pages/dashboard/dashboard.component.ts`

**Context:** `DashboardComponent` implements `OnInit` and fetches data in `ngOnInit()` via `forkJoin`. Add `OnDestroy` and an RxJS `timer` that re-fires the same fetch every 60 seconds. The timer fires first at 60s (not 0s — data already loaded on init).

- [ ] **Step 1: Update `DashboardComponent` to add 60-second polling**

  In `web/src/app/pages/dashboard/dashboard.component.ts`:

  1. Change the import line to add `OnDestroy`:
  ```typescript
  import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
  ```

  2. Add RxJS imports:
  ```typescript
  import { forkJoin, timer, Subscription } from 'rxjs';
  import { switchMap } from 'rxjs/operators';
  ```
  (Replace the existing `import { forkJoin } from 'rxjs';` line.)

  3. Add `implements OnDestroy` to the class declaration:
  ```typescript
  export class DashboardComponent implements OnInit, OnDestroy {
  ```

  4. Add a private subscription property to the class:
  ```typescript
  private refreshSub: Subscription | null = null;
  ```

  5. At the **end** of `ngOnInit()`, after the existing `forkJoin(...)` call, add:
  ```typescript
    // Auto-refresh every 60 seconds
    this.refreshSub = timer(60_000, 60_000).subscribe(() => {
      forkJoin({
        balance:      this.api.getBalance(),
        summary:      this.api.getStatisticsSummary(),
        transactions: this.api.getTransactions({ limit: 5 }),
        budget:       this.api.getBudget(),
        monthly:      this.api.getMonthlyStats(),
      }).subscribe({
        next: ({ balance, summary, transactions, budget, monthly }) => {
          this.balance  = balance;
          this.summary  = summary;
          this.recentTx = transactions.items;
          this.budgets  = budget;
          this.monthly  = monthly;
          this.buildStats();
        },
      });
    });
  ```

  6. Add the `ngOnDestroy` method to the class:
  ```typescript
  ngOnDestroy() {
    this.refreshSub?.unsubscribe();
  }
  ```

  **Important:** You need to read the component to find `buildStats()` (or whatever the stats-building method is called) before adding the refresh subscriber. Use the exact method name from the file.

- [ ] **Step 2: Build web to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/app/pages/dashboard/dashboard.component.ts
  git commit -m "feat(web/dashboard): add 60-second auto-refresh"
  ```

---

## Self-review

**Spec coverage:**

| Requirement | Task | Closed by |
|---|---|---|
| Budget creation from web | B1 + B2 | `POST /budget` API + inline form UI |
| Recurring delete from web | B3 + B4 | `DELETE /recurring/:id` API + delete button UI |
| Dashboard auto-refresh | B5 | 60-second RxJS timer in DashboardComponent |

**Placeholder scan:** No TBDs. The only approximation is "find the card header in recurring HTML" in B4 Step 3 — the implementer must read the file first, which is explicitly stated. ✓

**Type consistency:** `SetBudgetRequest` defined in B2 Step 1, consumed in B2 Step 2. `deleteRecurring(id: string)` added in B4 Step 1, called in B4 Step 2. All match. ✓

**Dependency order:** B1 must complete before B2 (API before web calls it). B3 must complete before B4. B5 is independent. ✓
