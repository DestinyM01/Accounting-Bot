# Follow-ups Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the follow-ups the user chose: fixes a user would notice, "Load more" paging and balance-history order, and build and cleanup.

**Architecture:** Thirteen small, independent tasks across `api/` and `web/`. Two new shared units:
- `api/src/shared/cursor.ts`: time-and-id cursors.
- `api/src/cash/counter-repair.service.ts`: the withdrawal counter repair, which moves out of `CashService` so `TransactionsService` can use it too.

Everything else is a local edit.

**Tech Stack:**
- NestJS 10 + Mongoose 8 + Jest in `api/` (`cd api && npx jest …`; tests run in America/Santo_Domingo).
- Angular 17 standalone in `web/` (verify with `cd web && npx ng build`; there is no web test runner).
- pnpm 11.3.0.

**Spec:** `docs/superpowers/specs/2026-09-25-follow-ups-design.md`

**Baseline:** api 65 suites / 782 tests passing; web build clean.

**Repo rules (every task):**
- The repo is PUBLIC: no real names, account numbers, emails or ids.
- End every commit message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't push.
- In stylesheets, use theme tokens only.
- Read each file before editing it. The plan quotes the current code where it matters. If a quoted anchor differs slightly, make the equivalent change and report it.

---

## File structure

| Area | Files | Task |
|---|---|---|
| Visual fixes | `web/src/app/pages/recurring/recurring.component.scss`, `web/src/tokens.css`, `web/src/app/pages/budget/budget.component.html`, `web/src/app/pages/balance/balance.component.{ts,html}` | 1 |
| Review dropdown | `web/src/app/pages/transactions/transactions.component.{ts,html}` | 2 |
| Merchants status, Calculator money, cash panel | `web/src/app/pages/merchants/*`, `web/src/app/pages/calculator/*` (+ new `calc-money.ts`), `web/src/app/pages/transactions/cash-panel/cash-panel.component.ts` | 3 |
| Counter repair | new `api/src/cash/counter-repair.service.ts` (+ spec), `cash.service.ts`, `cash.module.ts`, `transactions.service.ts`, `transactions.module.ts` (+ specs) | 4 |
| Settings reset | `api/src/settings/settings.{service,controller}.ts` (+ spec), `web/.../api.service.ts`, `web/src/app/pages/settings/{accounts,reports}-section/*` | 5 |
| Unreadable window, old fields | `api/src/ingestion/ingestion-status.service.ts`, `ingestion.service.ts` (+ specs) | 6 |
| Transactions cursor | new `api/src/shared/cursor.ts` (+ spec), `api/src/transactions/transactions.{service,controller}.ts` (+ specs), web `api.models.ts`, `api.service.ts`, `transactions.component.ts` | 7 |
| History order and cursor | `api/src/shared/schemas/balance{,-history}.schema.ts`, `api/src/shared/ledger/ledger.service.ts`, `api/src/balance/balance.{service,controller}.ts` (+ specs), web `api.models.ts`, `api.service.ts`, `balance.component.ts` | 8 |
| Recurring retry | `api/src/shared/schemas/recurring.schema.ts`, `api/src/recurring/due-occurrences.ts`, `recurring-scheduler.service.ts` (+ specs) | 9 |
| Reports | `api/src/reports/report-data.service.ts`, `report-render.ts`, `api/src/shared/schemas/report-send.schema.ts` (+ specs) | 10 |
| Shared helpers | new `web/src/app/core/ui/focus.ts`, `web/src/styles/_form-controls.scss`, categories/merchants/transactions components; new `api/src/test-utils/query-stub.ts`, balance/report-data specs | 11 |
| Chart colours | `web/src/app/core/ui/chart-theme.ts` | 12 |
| Images | `api/Dockerfile`, `web/Dockerfile` | 13 |

---

### Task 1: Visual fixes — Recurring on phones, readable muted text, Budget "View All", Balance chart loading

**Files:** `web/src/app/pages/recurring/recurring.component.scss`, `web/src/tokens.css`, `web/src/app/pages/budget/budget.component.html`, `web/src/app/pages/balance/balance.component.ts`, `web/src/app/pages/balance/balance.component.html`

- [ ] **Step 1: Recurring phone layout.** Append to `recurring.component.scss`:

```scss
// A phone is too narrow for the table's five columns and for two panels side by
// side: everything stacks. The flow chart keeps its own ≤ 700 px hide above.
@media (max-width: 640px) {
  .summary-row,
  .bottom-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .table-head {
    display: none;
  }

  .table-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'tx del'
      'sched amt'
      'cat amt';
    row-gap: 6px;
    padding: 14px 16px;

    .col-tx { grid-area: tx; min-width: 0; }
    .col-sched { grid-area: sched; }
    .col-cat { grid-area: cat; }
    .col-amt { grid-area: amt; align-self: center; text-align: right; }
    .col-del { grid-area: del; }
  }

  .row-name {
    overflow-wrap: anywhere;
  }
}
```

- [ ] **Step 2: Readable secondary text.** In `web/src/tokens.css`, change `--color-ink-2:          oklch(48%   0.02  230);` to:

```css
  --color-ink-2:          oklch(60%   0.02  230);   /* ≥ 4.5:1 on paper, card and card-alt */
```

- [ ] **Step 3: Budget "View All".** In `budget.component.html`, delete the line `<span class="link">View All</span>`. Every category card is already listed below it.

- [ ] **Step 4: Balance chart loading.**
  - In `balance.component.ts`, add a field `chartLoading = false;` next to `chartError`.
  - In `loadChart()`, set `this.chartLoading = true;` before the request, and `this.chartLoading = false;` in both the `next` and `error` callbacks.
  - In `balance.component.html`, inside the chart `<section>` right after the `chartError` block, add:

```html
    @if (chartLoading && daily.length === 0) {
      <p class="bal-muted">Loading…</p>
    }
```

- [ ] **Step 5: Build.**

Run: `cd web && npx ng build`
Expected: "Application bundle generation complete." with no errors.

- [ ] **Step 6: Commit.**

```bash
git add web/src/app/pages/recurring/recurring.component.scss web/src/tokens.css web/src/app/pages/budget/budget.component.html web/src/app/pages/balance
git commit -m "fix(web): Recurring stacks on phones; readable muted text; no dead View All; chart shows Loading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Review dropdown and the keyboard

**Files:** `web/src/app/pages/transactions/transactions.component.ts`, `web/src/app/pages/transactions/transactions.component.html`

On Windows, ↑/↓ on a closed `<select>` changes its value and fires `change`, which files the row. Keyboard choices now wait for Enter or blur, and pointer choices still file at once.

- [ ] **Step 1: Component.** In `transactions.component.ts`, add these members right above `assignCategory(`:

```ts
  /** Rows whose dropdown is being moved through with the keyboard: their change waits for Enter or blur. */
  private readonly keyPicking = new Set<string>();

  /** Keys that move a closed dropdown's value (on Windows each one fires `change`). */
  private static readonly PICK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

  onPickKey(tx: Transaction, e: KeyboardEvent, select: HTMLSelectElement) {
    if (TransactionsComponent.PICK_KEYS.has(e.key)) {
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
```

- [ ] **Step 2: Template.** In `transactions.component.html`, on the review `<select [id]="'pick-' + tx._id" …>`, replace

```html
                        (change)="assignCategory(tx, $any($event.target).value, $any($event.target))">
```

with

```html
                        (change)="onPickChange(tx, $any($event.target))"
                        (keydown)="onPickKey(tx, $event, $any($event.target))"
                        (blur)="onPickBlur(tx, $any($event.target))">
```

- [ ] **Step 3: Build.**

Run: `cd web && npx ng build`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add web/src/app/pages/transactions/transactions.component.ts web/src/app/pages/transactions/transactions.component.html
git commit -m "fix(web): arrowing through a review dropdown no longer files the row; Enter or leaving does

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Merchants status by the row, Calculator big numbers, cash panel closed mid-add

**Files:**
- `web/src/app/pages/merchants/merchants.component.{ts,html,scss}`
- create `web/src/app/pages/calculator/calc-money.ts`
- `web/src/app/pages/calculator/calculator.component.{ts,html}`
- `web/src/app/pages/transactions/cash-panel/cash-panel.component.ts`

- [ ] **Step 1: Merchants — decide where the status shows.** In `merchants.component.ts`:
  - Add a field below `status = '';`:

```ts
  /** Where the visual status shows: a merchant id (under that row), 'end' (after the list) or 'top'. */
  statusAt: string = 'top';
```

  - Give `run()` a fourth parameter, `anchor: string`, and set `this.statusAt = anchor;` next to `this.status = done(reply);`.
  - Update the three callers:
    - `add()` → `'top'`;
    - `saveChange(m)` → `m.id`;
    - `forget(m)` → `next?.id ?? 'end'`, with `next` computed as it already is.
  - In `load()`, where it sets `this.status = 'That merchant is no longer remembered.'`, also set `this.statusAt = 'top';`.

- [ ] **Step 2: Merchants template and styles.** In `merchants.component.html`:
  - Replace `<p class="mer-status" aria-live="polite">{{ status }}</p>` with:

```html
  <p class="mer-live" aria-live="polite">{{ status }}</p>
  @if (status && statusAt === 'top') {
    <p class="mer-status" aria-hidden="true">{{ status }}</p>
  }
```

  - Inside each `<li class="mer-row">`, as its last child, add:

```html
              @if (status && statusAt === m.id) {
                <p class="mer-row-status" aria-hidden="true">{{ status }}</p>
              }
```

  - Right after the closing `</ul>` of the list, add:

```html
        @if (status && statusAt === 'end') {
          <p class="mer-row-status" aria-hidden="true">{{ status }}</p>
        }
```

In `merchants.component.scss`, add:

```scss
// The one announced copy of the status; the visible copies sit next to what changed.
.mer-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.mer-row-status {
  flex: 1 1 100%;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
```

- [ ] **Step 3: Calculator money.** Create `web/src/app/pages/calculator/calc-money.ts`:

```ts
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

/**
 * Money on the growth calculator. Results can be astronomically large
 * (e.g. $1 at 100% for 60 years), so above a trillion it turns compact
 * ("$1.4T"), and above $999T it just says so — never E notation.
 */
export function calcMoney(n: number, cents = true): string {
  const abs = Math.abs(n);
  if (abs >= 1e15) return n < 0 ? '−over $999T' : 'over $999T';
  if (abs >= 1e12) return COMPACT.format(n);
  return (cents ? EXACT : WHOLE).format(n);
}
```

In `calculator.component.ts`:
- `import { calcMoney } from './calc-money';` and add a public member `readonly money = calcMoney;`;
- replace the two local `const money = (n: number) => n.toLocaleString(…)` helpers with `calcMoney`;
- replace the y-axis tick callback's `value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })` with `calcMoney(Number(value), false)`.

In `calculator.component.html`, replace every `{{ X | currency: 'USD' : 'symbol' : '1.2-2' }}` with `{{ money(X) }}`, including the `0 | currency…` one. Then remove `CurrencyPipe` from the component's `imports` if nothing else uses it.

- [ ] **Step 4: Cash panel closed mid-add.** In `cash-panel.component.ts`, the add and remove requests are added to `this.subs`, which the panel unsubscribes when it closes, so their replies are dropped. Change both:

In `add()`:
- keep the amount in a const before the request: `const amount = Math.round(this.amount! * 100) / 100;`, and use it in the request body;
- subscribe WITHOUT `this.subs.add(...)`;
- make the handlers:

```ts
        next: () => {
          if (this.destroyed) {
            // The panel closed while saving: the item exists, so keep the row's line honest.
            this.tx.allocatedCash = Math.round(((this.tx.allocatedCash ?? 0) + amount) * 100) / 100;
            return;
          }
          …the existing success code…
        },
        error: (e: HttpErrorResponse) => {
          if (this.destroyed) return;
          …the existing error code…
        },
```

Do the same in `remove(index)`: subscribe without `this.subs`. On success while destroyed, run `this.tx.allocatedCash = Math.max(0, Math.round(((this.tx.allocatedCash ?? 0) - item.amount) * 100) / 100); return;`. On error while destroyed, `return`. `this.tx` is the list's row object, so the row's "not itemized" figure follows.

- [ ] **Step 5: Build.**

Run: `cd web && npx ng build`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add web/src/app/pages/merchants web/src/app/pages/calculator web/src/app/pages/transactions/cash-panel/cash-panel.component.ts
git commit -m "fix(web): Merchants status beside the change; no E notation on the calculator; a closed cash panel still updates its row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Counter repair as a service; amount edits use it

**Files:**
- Create: `api/src/cash/counter-repair.service.ts`, `api/src/cash/counter-repair.service.spec.ts`
- Modify: `api/src/cash/cash.service.ts` (+ spec), `api/src/cash/cash.module.ts`, `api/src/transactions/transactions.service.ts` (+ spec), `api/src/transactions/transactions.module.ts`

- [ ] **Step 1: Write the failing tests.** Create `api/src/cash/counter-repair.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { CounterRepairService } from './counter-repair.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';

const W = '64b0000000000000000000a1';
function query(result: unknown) {
  const q: any = { lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}
const withdrawal = (over: Record<string, unknown> = {}) => ({
  _id: W, userId: 1, amount: -5000, isWithdrawal: true, allocatedCash: 4500, ...over,
});

describe('CounterRepairService', () => {
  let service: CounterRepairService;
  let txModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let itemModel: { find: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { findOne: jest.fn(() => query(withdrawal())), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    itemModel = { find: jest.fn(() => query([{ amount: 3000 }])) };
    const mod = await Test.createTestingModule({
      providers: [
        CounterRepairService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
      ],
    }).compile();
    service = mod.get(CounterRepairService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lowers a counter above its items to their sum, guarded on the value read', async () => {
    await expect(service.repair(W)).resolves.toBe(true);
    expect(txModel.findOne).toHaveBeenCalledWith({ _id: W, userId: 1, deletedAt: null });
    expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: W });
    expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1, allocatedCash: 4500 }, { $set: { allocatedCash: 3000 } });
  });

  it('leaves a counter within half a cent of its items alone', async () => {
    txModel.findOne.mockReturnValue(query(withdrawal({ allocatedCash: 3000.004 })));
    await expect(service.repair(W)).resolves.toBe(false);
    expect(txModel.updateOne).not.toHaveBeenCalled();
  });

  it('reports no repair when the guarded write missed', async () => {
    txModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(service.repair(W)).resolves.toBe(false);
  });

  it.each([
    ['a missing withdrawal', null],
    ['an ordinary expense', withdrawal({ isWithdrawal: false })],
    ['an internal transfer', withdrawal({ transferKind: 'internal' })],
  ])('never touches %s', async (_label, row) => {
    txModel.findOne.mockReturnValue(query(row));
    await expect(service.repair(W)).resolves.toBe(false);
    expect(txModel.updateOne).not.toHaveBeenCalled();
  });
});
```

In `transactions.service.spec.ts`:
- add a `CounterRepairService` mock to the testing module: `{ provide: CounterRepairService, useValue: repair }`, where `repair = { repair: jest.fn().mockResolvedValue(false) }` is created in `beforeEach`;
- import the class from `../cash/counter-repair.service`;
- add these tests to the `update` describe. Use the file's existing way of making `findOne` resolve a row; the row's shape is `{ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 480, transferKind: undefined, transactionName: 'cajero' }`:

```ts
    it('repairs a stuck withdrawal counter once, then lets a fair amount edit through', async () => {
      // First read: the counter (480) blocks shrinking to 400. After the repair the row reads 300.
      txModelMock.findOne
        .mockResolvedValueOnce({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 480, transactionName: 'cajero' })
        .mockResolvedValueOnce({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 300, transactionName: 'cajero' });
      repair.repair.mockResolvedValue(true);
      txModelMock.findOneAndUpdate.mockResolvedValue({ _id: 't1' });
      await expect(service.update('t1', { amount: 400 })).resolves.toBeUndefined();
      expect(repair.repair).toHaveBeenCalledWith('t1');
    });

    it('still refuses when the items really hold more than the new amount, naming what they hold', async () => {
      txModelMock.findOne.mockResolvedValue({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 480, transactionName: 'cajero' });
      repair.repair.mockResolvedValue(false);
      await expect(service.update('t1', { amount: 400 })).rejects.toThrow(/\$480\.00 of this withdrawal is itemized/);
    });
```

Rename `txModelMock` to whatever that spec calls its transaction model mock, and make `findOne` return what `update()` awaits: a document or a query. If that spec has no update-path setup to reuse, add these two tests in a new `describe('update: a stuck counter')` with its own minimal mocks built like the file's existing ones.

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/cash/counter-repair.service.spec.ts src/transactions/transactions.service.spec.ts`
Expected: FAIL. `Cannot find module './counter-repair.service'`.

- [ ] **Step 3: Create `api/src/cash/counter-repair.service.ts`.** Move the logic of `CashService.repairCounter` into it:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { NOT_DELETED, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { HALF_CENT, round2 } from './cash-rules';

/**
 * Repairs a withdrawal's itemized counter (Transaction.allocatedCash) left above
 * its items — by a crash between the reservation and the insert, or an ambiguous
 * insert error — by lowering it to the items' sum with a write guarded on the value
 * read. Used when that high counter blocks something: an itemize (CashService.add)
 * or an amount edit (TransactionsService.update).
 *
 * Known limit: an add from another tab that has reserved but not yet inserted, a
 * concurrent remove() whose decrement hasn't landed, or a pending release after a
 * refused insert, in the same milliseconds, can leave the counter below the items
 * by that amount, which would allow over-itemizing by it. One user; accepted.
 */
@Injectable()
export class CounterRepairService {
  private readonly logger = new Logger(CounterRepairService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
  ) {}

  /** True when it lowered the counter; false when there was nothing to repair or the guard missed. */
  async repair(withdrawalId: string): Promise<boolean> {
    const tx = await this.txModel.findOne({ _id: withdrawalId, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx || !tx.isWithdrawal || !(tx.amount < 0) || isNonSpendingTransfer(tx.transferKind)) return false;
    const items = await this.itemModel.find({ userId: this.userId, withdrawalId: String(tx._id) }).lean();
    const sum = round2(items.reduce((s, i) => s + i.amount, 0));
    const counter = tx.allocatedCash ?? 0;
    if (counter <= sum + HALF_CENT) return false;
    const res = await this.txModel.updateOne(
      { _id: tx._id, userId: this.userId, allocatedCash: tx.allocatedCash },
      { $set: { allocatedCash: sum } },
    );
    if (!res.modifiedCount) return false;
    this.logger.warn(`Withdrawal ${String(tx._id)}: itemized counter was ${round2(counter)} but its items sum to ${sum}; corrected`);
    return true;
  }
}
```

- [ ] **Step 4: Wire it in.**
  - **`cash.service.ts`:**
    - inject `private readonly counters: CounterRepairService` in the constructor;
    - replace `this.repairCounter(withdrawalId)` with `this.counters.repair(withdrawalId)`;
    - delete the private `repairCounter` method and its doc comment.
  - **`cash.service.spec.ts`:** keep testing the add path's behaviour. Provide the real `CounterRepairService` in the testing module's `providers` next to `CashService`. It uses the same `txModel` and `itemModel` mocks, so the existing "a counter left high" tests keep working unchanged.
  - **`cash.module.ts`:** add `CounterRepairService` to `providers`, and add `exports: [CounterRepairService]` (keep any existing exports).
  - **`transactions.module.ts`:** add `CashModule` to `imports`. There is no cycle: `CashModule` imports only `CategoriesModule` and its models.
  - **`transactions.service.ts`:**
    - inject `private readonly counters: CounterRepairService`;
    - in `update()`, change `const tx = await this.transactionModel.findOne(...)` to `let tx = …`;
    - replace the withdrawal check with:

```ts
      // A withdrawal can't shrink below what's already itemized (see CashService).
      if (tx.isWithdrawal && Math.abs(newSigned) + HALF_CENT < (tx.allocatedCash ?? 0)) {
        // A counter left above its items blocks an honest edit: repair it once and look again.
        if (await this.counters.repair(id)) {
          tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
          if (!tx) throw new NotFoundException();
        }
        if (tx.isWithdrawal && Math.abs(newSigned) + HALF_CENT < (tx.allocatedCash ?? 0)) {
          throw new BadRequestException(`${money(tx.allocatedCash ?? 0)} of this withdrawal is itemized — remove items first`);
        }
      }
```

  - **The module-wiring test.** If `api/src/merchants/merchants.controller.spec.ts` builds `TransactionsModule` through its imports and now needs the `CashAllocation` model stub, add `'CashAllocation'` to its override list. It already includes it.

- [ ] **Step 5: Run the specs and the suite.**

Run: `cd api && npx jest src/cash src/transactions src/merchants && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: all tests pass and `tsc` prints nothing.

- [ ] **Step 6: Commit.**

```bash
git add api/src/cash api/src/transactions
git commit -m "fix(api): a stuck withdrawal counter no longer blocks an amount edit; one repair service for both paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settings "Use the server's config"

**Files:** `api/src/settings/settings.service.ts`, `api/src/settings/settings.controller.ts` (+ `settings.service.spec.ts`), `web/src/app/core/services/api.service.ts`, `web/src/app/pages/settings/accounts-section/accounts-section.component.{ts,html}`, `web/src/app/pages/settings/reports-section/reports-section.component.{ts,html}`

The routes answer the refreshed view (200) rather than an empty 204, so the page updates from the reply the same way it does after a save.

- [ ] **Step 1: Write the failing tests.** Add to `settings.service.spec.ts`:

```ts
  describe('reset', () => {
    it('forgets the saved reports section, so it follows the server config again', async () => {
      await service.resetReports();
      expect(model.updateOne).toHaveBeenCalledWith({ userId: 1 }, { $unset: { reports: '' } });
    });

    it('forgets the saved accounts section', async () => {
      await service.resetAccounts();
      expect(model.updateOne).toHaveBeenCalledWith({ userId: 1 }, { $unset: { accounts: '' } });
    });

    it('answers the refreshed view', async () => {
      process.env.OWN_CASH_ACCOUNTS = '2001,2002';
      const view = await service.resetAccounts();
      expect(view.accounts.cash).toEqual({ value: ['2001', '2002'], source: 'config' });
    });
  });
```

The `model.findOne` default mock returns `query(null)`, so after a reset the view reads env. Adjust `view.accounts.cash` to the view's real field names if they differ. Restore `OWN_CASH_ACCOUNTS` afterwards the way the file handles env.

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/settings`
Expected: FAIL, `service.resetReports is not a function`.

- [ ] **Step 3: Implement.** In `settings.service.ts`:

```ts
  /** Forgets the saved reports section: it follows the server's config (env) again. */
  async resetReports(): Promise<SettingsView> {
    await this.model.updateOne({ userId: this.userId }, { $unset: { reports: '' } });
    return this.view();
  }

  /** Forgets the saved accounts section: it follows the server's config (env) again. */
  async resetAccounts(): Promise<SettingsView> {
    await this.model.updateOne({ userId: this.userId }, { $unset: { accounts: '' } });
    return this.view();
  }
```

In `settings.controller.ts`, add `Delete` to the imports, then:

```ts
  @Delete('reports')
  resetReports() {
    return this.settings.resetReports();
  }

  @Delete('accounts')
  resetAccounts() {
    return this.settings.resetAccounts();
  }
```

- [ ] **Step 4: Web.** In `api.service.ts`, next to the settings save calls, add:

```ts
  resetReportSettings(): Observable<SettingsView> {
    return this.http.delete<SettingsView>(`${this.base}/settings/reports`);
  }

  resetAccountSettings(): Observable<SettingsView> {
    return this.http.delete<SettingsView>(`${this.base}/settings/accounts`);
  }
```

In each section component (accounts and reports):
- **The flag.** Add `confirmReset = false;` and a getter `get savedHere(): boolean`:
  - true for accounts when `view.cash.source === 'saved' || view.senders.source === 'saved'`;
  - true for reports when any of `view.weekly`, `view.monthly` or `view.recipient` has `source === 'saved'`;
  - use the view shape each component already reads.
- **A `resetToConfig()` method.**
  - On the first click it sets `confirmReset = true` and focuses the confirm button.
  - On confirm it calls the reset api. On success it applies the returned view exactly like the save path does, sets `saved = 'Now following the server's config.'` and clears `confirmReset`. On error it shows the message like the save path's error.
- **The template.** Add, inside the section's `.set-actions` area:

```html
      @if (savedHere) {
        @if (confirmReset) {
          <span role="alert">Forget what's saved here and follow the server's config?</span>
          <button [id]="SECTION + '-reset-yes'" type="button" class="fc-btn fc-btn--primary" (click)="resetToConfig()">Use the server's config</button>
          <button type="button" class="fc-btn fc-btn--ghost" (click)="confirmReset = false">Cancel</button>
        } @else {
          <button type="button" class="fc-btn fc-btn--ghost" [disabled]="saving" (click)="resetToConfig()">Use the server's config</button>
        }
      }
```

  Write `SECTION` as the literal `accounts` or `reports` in each template: `id="accounts-reset-yes"` or `id="reports-reset-yes"`. Use each component's existing busy flag name in place of `saving`.

- [ ] **Step 5: Run and build.**

Run: `cd api && npx jest src/settings && npx tsc --noEmit -p tsconfig.json && cd ../web && npx ng build`
Expected: the tests pass, `tsc` prints nothing, and the build is clean.

- [ ] **Step 6: Commit.**

```bash
git add api/src/settings web/src/app/core/services/api.service.ts web/src/app/pages/settings
git commit -m "feat: Settings sections can go back to the server's config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Unreadable records outside the window; old status fields

**Files:** `api/src/ingestion/ingestion-status.service.ts` (+ spec), `api/src/ingestion/ingestion.service.ts` (+ spec)

- [ ] **Step 1: Write the failing tests.** Add to `ingestion-status.service.spec.ts`:

```ts
  it('forgets unreadable mails from before the reading window, keeping dismissals', async () => {
    const since = new Date('2026-09-01T04:00:00Z');
    await service.forgetUnreadableBefore(since);
    expect(unreadableModel.deleteMany).toHaveBeenCalledWith({ userId: 1, receivedAt: { $lt: since }, dismissed: { $ne: true } });
  });

  it('removes the old skipped/failed fields when it records a run', async () => {
    await service.recordRun({ created: 1, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      expect.objectContaining({ $unset: { skipped: '', failed: '' } }),
      expect.objectContaining({ upsert: true, strict: false }),
    );
  });
```

Use the file's own user id and `AT` constant. If its `userId` isn't 1, match it.

Update the existing `recordRun` expectation in that spec: the update gains `$unset: { skipped: '', failed: '' }`, and the options become `{ upsert: true, strict: false }`.

Add to `ingestion.service.spec.ts`, and add `forgetUnreadableBefore: jest.fn().mockResolvedValue(undefined)` to the `status` mock and its type:

```ts
  it('forgets unreadable mails from before the reading window on each run', async () => {
    await service.run();
    expect(status.forgetUnreadableBefore).toHaveBeenCalledWith(expect.any(Date));
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/ingestion/ingestion-status.service.spec.ts src/ingestion/ingestion.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `ingestion-status.service.ts`, add:

```ts
  /**
   * Forgets unreadable mails received before the reading window: they can't be
   * fetched again, so they would sit on the list forever. Dismissals are kept, in
   * case the start date moves back.
   */
  async forgetUnreadableBefore(since: Date): Promise<void> {
    await this.quietly('forget unreadable mails outside the window', () =>
      this.unreadableModel.deleteMany({ userId: this.userId, receivedAt: { $lt: since }, dismissed: { $ne: true } }),
    );
  }
```

In `recordRun`, add `$unset: { skipped: '', failed: '' }` next to the `$set`. Change the options to `{ upsert: true, strict: false }`, and add a comment: *the old counts are no longer in the schema; strict: false lets this one write remove them.*

In `ingestion.service.ts` `run()`, right after `const mails = await this.mail.fetchSince(since, senders);`, add:

```ts
    // Mails before the window can't come back: don't leave them on the unreadable list.
    await this.status.forgetUnreadableBefore(since);
```

- [ ] **Step 4: Run the specs and the suite.**

Run: `cd api && npx jest src/ingestion && npx jest`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/ingestion
git commit -m "fix(api): unreadable mails outside the window drop off; old status counts are removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cursor paging for Transactions

**Files:**
- Create: `api/src/shared/cursor.ts`, `api/src/shared/cursor.spec.ts`
- Modify: `api/src/transactions/transactions.service.ts`, `transactions.controller.ts` (+ `transactions.service.spec.ts`)
- Modify: `web/src/app/core/services/api.models.ts`, `api.service.ts`, `web/src/app/pages/transactions/transactions.component.ts`

- [ ] **Step 1: Write the failing cursor tests.** Create `api/src/shared/cursor.spec.ts`:

```ts
import { Types } from 'mongoose';
import { afterTime, encodeTimeCursor, parseTimeCursor } from './cursor';

const ID = '64b0000000000000000000a1';
const T = new Date('2026-09-20T15:00:00.000Z');

describe('time cursor', () => {
  it('round-trips a timestamp and an id', () => {
    const raw = encodeTimeCursor(T, ID);
    expect(raw).toBe(`2026-09-20T15:00:00.000Z_${ID}`);
    const c = parseTimeCursor(raw)!;
    expect(c.t.toISOString()).toBe(T.toISOString());
    expect(String(c.id)).toBe(ID);
  });

  it.each([['empty', ''], ['no id', '2026-09-20T15:00:00.000Z'], ['bad date', `nope_${ID}`], ['bad id', '2026-09-20T15:00:00.000Z_nope']])(
    'rejects a malformed cursor (%s)',
    (_label, raw) => expect(parseTimeCursor(raw)).toBeNull(),
  );

  it('asks for the rows after the cursor in (timestamp desc, _id desc) order', () => {
    const c = parseTimeCursor(encodeTimeCursor(T, ID))!;
    expect(afterTime(c)).toEqual({
      $or: [{ timestamp: { $lt: T } }, { timestamp: T, _id: { $lt: new Types.ObjectId(ID) } }],
    });
  });
});
```

- [ ] **Step 2: Create `api/src/shared/cursor.ts`.**

```ts
import { Types } from 'mongoose';

/** A position in a list sorted by (timestamp desc, _id desc): the last row a page showed. */
export interface TimeCursor {
  t: Date;
  id: Types.ObjectId;
}

export function encodeTimeCursor(timestamp: Date, id: unknown): string {
  return `${new Date(timestamp).toISOString()}_${String(id)}`;
}

/** The cursor, or null when it's malformed (the caller answers 400). */
export function parseTimeCursor(raw: string): TimeCursor | null {
  const cut = raw.lastIndexOf('_');
  if (cut <= 0) return null;
  const t = new Date(raw.slice(0, cut));
  const id = raw.slice(cut + 1);
  if (isNaN(t.getTime()) || !/^[0-9a-f]{24}$/i.test(id)) return null;
  return { t, id: new Types.ObjectId(id) };
}

/** The filter for the rows after `c` in (timestamp desc, _id desc) order. */
export function afterTime(c: TimeCursor) {
  return { $or: [{ timestamp: { $lt: c.t } }, { timestamp: c.t, _id: { $lt: c.id } }] };
}
```

Run: `cd api && npx jest src/shared/cursor.spec.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing list tests.** In `transactions.service.spec.ts`, using its chainable model mock (`find`/`sort`/`skip`/`limit`/`select`/`lean`, `countDocuments`), add:

```ts
  describe('findAll paging', () => {
    it('sorts by time then id, and hands back a cursor after a full page', async () => {
      const rows = [
        { _id: '64b0000000000000000000a2', timestamp: new Date('2026-09-20T15:00:00Z'), amount: -10 },
        { _id: '64b0000000000000000000a1', timestamp: new Date('2026-09-20T15:00:00Z'), amount: -20 },
      ];
      mockModel.lean.mockResolvedValue(rows);
      mockModel.countDocuments.mockResolvedValue(5);
      const page = await service.findAll({ limit: 2 });
      expect(mockModel.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
      expect(page.nextCursor).toBe('2026-09-20T15:00:00.000Z_64b0000000000000000000a1');
    });

    it('says there is no next page after a short page', async () => {
      mockModel.lean.mockResolvedValue([{ _id: '64b0000000000000000000a1', timestamp: new Date(), amount: -1 }]);
      const page = await service.findAll({ limit: 20 });
      expect(page.nextCursor).toBeNull();
    });

    it('continues after a cursor, combined with the filters, without skipping', async () => {
      await service.findAll({ limit: 20, before: '2026-09-20T15:00:00.000Z_64b0000000000000000000a1', needsReview: true });
      const filter = mockModel.find.mock.calls[0][0];
      expect(filter.$and).toEqual([
        expect.objectContaining({ categoryNeedsReview: true }),
        { $or: [
          { timestamp: { $lt: new Date('2026-09-20T15:00:00.000Z') } },
          { timestamp: new Date('2026-09-20T15:00:00.000Z'), _id: { $lt: expect.anything() } },
        ] },
      ]);
      expect(mockModel.skip).not.toHaveBeenCalled();
    });

    it('answers 400 for a malformed cursor', async () => {
      await expect(service.findAll({ before: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
```

Use the spec's real mock variable names, and import `BadRequestException` if needed. The count is still computed from the filter without the cursor, so `total` stays the whole set.

- [ ] **Step 4: Run them and watch them fail.**

Run: `cd api && npx jest src/transactions/transactions.service.spec.ts -t "paging"`
Expected: FAIL.

- [ ] **Step 5: Implement.** In `transactions.service.ts`:
  - add `before?: string;` to `TransactionQuery`;
  - add `nextCursor: string | null;` to `TransactionPage`;
  - import `{ afterTime, encodeTimeCursor, parseTimeCursor }` from `'../shared/cursor'`;
  - replace `findAll` with:

```ts
  async findAll(query: TransactionQuery): Promise<TransactionPage> {
    const filter = this.buildFilter(query);
    const limit  = Math.min(query.limit || 50, 200);
    const offset = query.offset || 0;

    // "Load more" continues after the last row shown (a cursor), so rows that
    // leave or join the filtered set between loads never shift a page.
    let pageFilter: Record<string, unknown> = filter;
    if (query.before) {
      const cursor = parseTimeCursor(query.before);
      if (!cursor) throw new BadRequestException('before must be a cursor from a previous page');
      pageFilter = { $and: [filter, afterTime(cursor)] };
    }

    let find = this.transactionModel.find(pageFilter).sort({ timestamp: -1, _id: -1 });
    if (!query.before && offset) find = find.skip(offset);
    const [items, total] = await Promise.all([
      find
        .limit(limit)
        .select('transactionName transactionType amount timestamp category categoryNeedsReview merchant source transferKind isWithdrawal allocatedCash')
        .lean(),
      this.transactionModel.countDocuments(filter),
    ]);

    const normalised = items.map((t) => ({
      ...t,
      amount:    Math.abs(t.amount),
      isExpense: t.amount < 0,
    }));
    const last = items[items.length - 1];
    const nextCursor = items.length === limit && last ? encodeTimeCursor(last.timestamp, last._id) : null;

    return { items: normalised, total, limit, offset, nextCursor };
  }
```

In `transactions.controller.ts`, add `@Query('before') before?: string,` and pass `before` into the query object.

If an existing spec asserted `.sort({ timestamp: -1 })` or `skip(0)`, update it to the new call.

- [ ] **Step 6: Web.**
  - **`api.models.ts`:** `TransactionPage` gains `nextCursor: string | null;`.
  - **`api.service.ts` `getTransactions`:** the options gain `before?: string`, with `if (opts.before) params = params.set('before', opts.before);`.
  - **`transactions.component.ts`:**
    - replace the `offset` field with `nextCursor: string | null = null;`;
    - `load(append)`: send `before: append ? this.nextCursor ?? undefined : undefined` instead of `offset`, and on success set `this.nextCursor = page.nextCursor;`;
    - `reloadInPlace()`: drop the `offset` lines, send no `before`, and on success set `this.nextCursor = page.nextCursor;`;
    - `loadMore()` becomes `loadMore() { this.load(true); }`;
    - `hasMore` becomes `get hasMore() { return this.nextCursor !== null; }`;
    - remove every `this.offset = 0;` (a non-append load starts from the top anyway).

- [ ] **Step 7: Run and build.**

Run: `cd api && npx jest src/transactions src/shared && npx tsc --noEmit -p tsconfig.json && cd ../web && npx ng build`
Expected: the tests pass, `tsc` prints nothing, and the build is clean.

- [ ] **Step 8: Commit.**

```bash
git add api/src/shared/cursor.ts api/src/shared/cursor.spec.ts api/src/transactions web/src/app/core/services web/src/app/pages/transactions/transactions.component.ts
git commit -m "fix: Transactions load more by cursor, so a row that leaves the filter never shifts a page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Balance history order (seq) and cursor

**Files:** `api/src/shared/schemas/balance.schema.ts`, `api/src/shared/schemas/balance-history.schema.ts`, `api/src/shared/ledger/ledger.service.ts` (+ spec), `api/src/balance/balance.service.ts`, `api/src/balance/balance.controller.ts` (+ `balance.service.spec.ts`), `web/src/app/core/services/api.models.ts`, `api.service.ts`, `web/src/app/pages/balance/balance.component.ts`

- [ ] **Step 1: Write the failing ledger tests.** In `ledger.service.spec.ts`, update the first `apply` expectation to:

```ts
      { $inc: { balance: -250, seq: 1 }, $set: { lastActivity: expect.any(Date) } },
```

Then add:

```ts
  it('stamps the history row with the sequence number from the same atomic write', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 750, seq: 42 });
    await service.apply(-250, 'expense', 'coffee', 't1');
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 42 }));
  });

  it('setTo numbers its row one past the pre-image', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 500, seq: 7 });
    await service.setTo(900, 'fix');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 },
      { $set: { balance: 900, lastActivity: expect.any(Date) }, $inc: { seq: 1 } },
      expect.objectContaining({ new: false }),
    );
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 8 }));
  });
```

If other existing `setTo` expectations pin the exact update object, add `$inc: { seq: 1 }` to them. The reason string must be one this spec already uses (e.g. `'expense'`); adjust if needed.

- [ ] **Step 2: Write the failing history tests.** In `balance.service.spec.ts`, add:

```ts
  describe('history paging and order', () => {
    it('orders by sequence, then time, then id', async () => {
      await service.history({});
      expect(historyModel.find.mock.results[0].value.sort).toHaveBeenCalledWith({ seq: -1, timestamp: -1, _id: -1 });
    });

    it('hands back an s-cursor for a numbered row and continues below it, older rows included', async () => {
      historyModel.find.mockReturnValueOnce(query(Array.from({ length: 2 }, (_, i) => ({
        _id: `64b0000000000000000000a${i}`, seq: 10 - i, timestamp: new Date('2026-09-20T15:00:00Z'), reason: 'expense', delta: -1, newBalance: 1,
      }))));
      const page = await service.history({ limit: '2' });
      expect(page.nextCursor).toBe('s9');
      await service.history({ limit: '2', before: 's9' });
      expect(historyModel.find.mock.calls[1][0]).toEqual({
        userId: 1,
        $or: [{ seq: { $lt: 9 } }, { seq: { $exists: false } }],
      });
    });

    it('continues among un-numbered rows by time and id, with the reason filter', async () => {
      await service.history({ before: 't2026-09-01T10:00:00.000Z_64b0000000000000000000a1', reason: 'manual' });
      expect(historyModel.find.mock.calls[0][0]).toEqual({
        userId: 1,
        reason: 'manual',
        seq: { $exists: false },
        $or: [
          { timestamp: { $lt: new Date('2026-09-01T10:00:00.000Z') } },
          { timestamp: new Date('2026-09-01T10:00:00.000Z'), _id: { $lt: expect.anything() } },
        ],
      });
    });

    it('answers 400 for a malformed cursor', async () => {
      await expect(service.history({ before: 'x1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('closes each day on its last change by sequence', async () => {
      await service.daily({});
      const sorts = historyModel.find.mock.results.map((r: any) => r.value.sort.mock.calls[0]?.[0]);
      expect(sorts).toContainEqual({ timestamp: 1, seq: 1, _id: 1 });
      expect(historyModel.findOne.mock.results[0].value.sort).toHaveBeenCalledWith({ timestamp: -1, seq: -1, _id: -1 });
    });
  });
```

Use the spec's `query` helper and its user id, and import `BadRequestException` if needed.

- [ ] **Step 3: Run them and watch them fail.**

Run: `cd api && npx jest src/shared/ledger src/balance`
Expected: FAIL.

- [ ] **Step 4: Schemas.**
  - **`balance.schema.ts`:** add `/** Incremented by every ledger write, in the same atomic update: orders history rows exactly. */ @Prop() seq?: number;`.
  - **`balance-history.schema.ts`:** add `/** Balance.seq after this change; absent on rows written before it existed. */ @Prop() seq?: number;`, and after the existing index `BalanceHistorySchema.index({ userId: 1, seq: -1 });`.

- [ ] **Step 5: Ledger.** In `ledger.service.ts`:
  - `recordHistory`'s row type gains `seq?: number`.
  - **`apply`:** the update becomes `{ $inc: { balance: delta, seq: 1 }, $set: { lastActivity: new Date() } }`, and it passes `seq: updated.seq` to `recordHistory`.
  - **`setTo`:** the update becomes `{ $set: { balance: target, lastActivity: new Date() }, $inc: { seq: 1 } }`, and it passes `seq: (before?.seq ?? 0) + 1` to `recordHistory`.
  - Add one line to the class comment: *seq numbers every change in the order the balance saw them; history sorts by it.*

- [ ] **Step 6: History service.** In `balance.service.ts`:
  - import `{ afterTime, encodeTimeCursor, parseTimeCursor }` from `'../shared/cursor'`;
  - `history`'s query type gains `before?: string`;
  - build the filter as now, then:

```ts
    // Rows with seq (every change since it existed) come first, newest first; older
    // rows have no seq and follow, by time. The cursor encodes which kind it stopped on.
    if (query.before !== undefined && query.before !== '') {
      const raw = query.before;
      if (/^s\d+$/.test(raw)) {
        filter.$or = [{ seq: { $lt: Number(raw.slice(1)) } }, { seq: { $exists: false } }];
      } else if (raw.startsWith('t') && parseTimeCursor(raw.slice(1))) {
        filter.seq = { $exists: false };
        Object.assign(filter, afterTime(parseTimeCursor(raw.slice(1))!));
      } else {
        throw new BadRequestException('before must be a cursor from a previous page');
      }
    }

    const find = this.historyModel.find(filter).sort({ seq: -1, timestamp: -1, _id: -1 });
    const [rows, total] = await Promise.all([
      (query.before ? find : find.skip(offset)).limit(limit).lean(),
      this.historyModel.countDocuments(filter),
    ]);
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last
        ? last.seq != null ? `s${last.seq}` : `t${encodeTimeCursor(last.timestamp, last._id)}`
        : null;
```

  - Add `nextCursor` to the returned object. Keep `total` as it is; the web no longer uses it for paging.
  - In `daily()`, the opening lookup's sort becomes `{ timestamp: -1, seq: -1, _id: -1 }` and the window rows' sort becomes `{ timestamp: 1, seq: 1, _id: 1 }`.
  - In `balance.controller.ts`'s history route, pass `before` through with the other query params.

- [ ] **Step 7: Web.**
  - **`api.models.ts`:** `BalanceHistoryPage` gains `nextCursor: string | null;`.
  - **`api.service.ts` `getBalanceHistory`:** the options gain `before?: string`, and it sets the `before` param when given.
  - **`balance.component.ts`:**
    - keep `nextCursor: string | null = null`;
    - the first page (the call with `offset: 0`) drops `offset` and stores `this.nextCursor = page.nextCursor`;
    - `loadMore()` sends `before: this.nextCursor ?? undefined` instead of `offset: this.items.length`, appends (keeping its duplicate drop), and stores the new `nextCursor`;
    - `hasMore` becomes `return this.nextCursor !== null;`.

- [ ] **Step 8: Run and build.**

Run: `cd api && npx jest && npx tsc --noEmit -p tsconfig.json && cd ../web && npx ng build`
Expected: all tests pass, `tsc` prints nothing, and the build is clean.

- [ ] **Step 9: Commit.**

```bash
git add api/src/shared/schemas/balance.schema.ts api/src/shared/schemas/balance-history.schema.ts api/src/shared/ledger api/src/balance web/src/app/core/services web/src/app/pages/balance/balance.component.ts
git commit -m "fix: balance history keeps the order the balance changed in, and loads more by cursor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A recurring edge failure is retried

**Files:** `api/src/shared/schemas/recurring.schema.ts`, `api/src/recurring/due-occurrences.ts` (+ spec), `api/src/recurring/recurring-scheduler.service.ts` (+ spec)

- [ ] **Step 1: Write the failing tests.** In `due-occurrences.spec.ts`, add:

```ts
describe('planOccurrences and a failed month', () => {
  const NOW = new Date('2026-09-25T15:00:00Z');
  const createdAt = new Date('2026-01-01T00:00:00Z');

  it('keeps retrying the failed month after it drifts past the 31-day window', () => {
    // Aug 20 is 36 days old: normally too old, but it's the month that failed.
    const plan = planOccurrences({ dayOfMonth: 20, createdAt, lastPeriod: '2026-07', failedPeriod: '2026-08' }, NOW);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-08', '2026-09']);
    expect(plan.tooOld).toEqual([]);
  });

  it('still skips old months that never failed', () => {
    const plan = planOccurrences({ dayOfMonth: 20, createdAt, lastPeriod: '2026-07' }, NOW);
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-08']);
  });
});
```

In `recurring-scheduler.service.spec.ts`:
- update the `markedHandled(rule, period)` helper's expected update to `{ $set: { lastPeriod: period, lastExecutedAt: expect.any(Date) }, $unset: { failedPeriod: '' } }`, keeping the helper's existing filter and `lastExecutedAt` expectation;
- add, inside `describe('sweep', …)`:

```ts
    it('remembers the month that failed, keeping the earliest', async () => {
      const rule = makeRule({ dayOfMonth: 20, lastPeriod: '2026-08' });
      recurringModel.find.mockResolvedValue([rule]);
      ledger.apply.mockRejectedValueOnce(new Error('balance write failed'));
      await service.sweep(NOW);
      expect(recurringModel.updateOne).toHaveBeenCalledWith(
        { _id: rule._id, $or: [{ failedPeriod: { $exists: false } }, { failedPeriod: { $gt: '2026-09' } }] },
        { $set: { failedPeriod: '2026-09' } },
      );
    });

    it('retries only the failed month in that sweep; later months wait for the next one', async () => {
      // July failed long ago and is still retrying; August is now older than 31 days too.
      const rule = makeRule({ dayOfMonth: 20, lastPeriod: '2026-06', failedPeriod: '2026-07' });
      recurringModel.find.mockResolvedValue([rule]);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ recurringPeriod: '2026-07' }));
      expect(recurringModel.updateOne).not.toHaveBeenCalledWith(...markedHandled(rule, '2026-08'));
    });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/recurring`
Expected: FAIL.

- [ ] **Step 3: Implement.**

- **`recurring.schema.ts`:** add

```ts
  /**
   * The earliest month whose booking failed and hasn't been handled since. It is
   * retried every hour even after it drifts past the 31-day window, so a failure
   * at the window's edge is never skipped for good. Cleared when handled.
   */
  @Prop() failedPeriod?: string;
```

- **`due-occurrences.ts`:**
  - `SchedulableRule` gains `failedPeriod?: string;`, and `schedulableFrom` takes `failedPeriod?: string` and passes it on;
  - in `planOccurrences`, change `if (dueAt.getTime() < windowStart) tooOld.push(occurrence);` to:

```ts
    // A month that failed stays due until it books: past the window it would be skipped for good.
    if (dueAt.getTime() < windowStart && occurrence.period !== rule.failedPeriod) tooOld.push(occurrence);
```

- **`recurring-scheduler.service.ts`:**
  - `markHandled` becomes:

```ts
  /** Forward-only: lastPeriod never moves back, whatever order writers land in. A handled month is no longer a failed one. */
  private async markHandled(rule: Recurring, period: string, now: Date): Promise<void> {
    await this.recurringModel.updateOne(
      { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
      { $set: { lastPeriod: period, lastExecutedAt: now }, $unset: { failedPeriod: '' } },
    );
  }
```

  - in `processRule`, while a failed month is retried, handle only that month this sweep:

```ts
    // While a failed month is being retried, this sweep handles only that month:
    // marking later too-old months, or booking later months, would move lastPeriod
    // past it (and skip too-old months without their log). The next sweep, with
    // lastPeriod at the retried month, handles the rest the usual way.
    const retrying = !!rule.failedPeriod && plan.due.some((o) => o.period === rule.failedPeriod);
    if (plan.tooOld.length > 0 && !retrying) {
```

    Keep the block's body. Then make the booking loop iterate over

```ts
    const toBook = retrying ? plan.due.filter((o) => o.period === rule.failedPeriod) : plan.due;
    for (const occurrence of toBook) {
```

    instead of `plan.due`.

  - in the occurrence loop, when `outcome === 'failed'` and before the `break`, remember it:

```ts
      if (outcome === 'failed') {
        await this.recurringModel
          .updateOne(
            { _id: rule._id, $or: [{ failedPeriod: { $exists: false } }, { failedPeriod: { $gt: occurrence.period } }] },
            { $set: { failedPeriod: occurrence.period } },
          )
          .catch((err) => this.logger.warn(`Could not remember failed ${occurrence.period} of ${String(rule._id)}: ${String(err)}`));
        break;
      }
```

    This replaces the plain `if (outcome === 'failed') break;`. If `updateOne` is mocked to return a plain Promise, `.catch` works; if the spec's mock returns an object without `.catch`, write it as a `try { await … } catch (err) { … }` block instead.

- [ ] **Step 4: Run the specs and the suite.**

Run: `cd api && npx jest src/recurring && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/shared/schemas/recurring.schema.ts api/src/recurring
git commit -m "fix(api): a recurring booking that fails at the window's edge is retried, not skipped for good

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Reports — month names once, typed send records

**Files:** `api/src/reports/report-data.service.ts`, `api/src/reports/report-render.ts` (+ their specs), `api/src/shared/schemas/report-send.schema.ts`

- [ ] **Step 1: Month number instead of name.**
  - **`report-data.service.ts`:**
    - in the weekly data's `month` object, replace `label: MONTHS[summary.month - 1],` with `monthNumber: summary.month,`;
    - delete the file's `MONTHS` constant;
    - update the exported data type: `month: { label: string; … }` becomes `month: { monthNumber: number; … }` (1–12).
  - **`report-render.ts`:**
    - where the weekly email builds its title, replace `` `${d.month.label} so far` `` with `` `${MONTHS[d.month.monthNumber - 1]} so far` ``;
    - update the type there too, if the render declares its own copy of the data type.
  - **Specs:** replace every `label: 'September'` (or similar) in the weekly report data with `monthNumber: 9`, or the matching number, in `report-data.service.spec.ts` and `report-render.spec.ts`. The rendered text must not change, so any assertion on "September so far" stays.

- [ ] **Step 2: Typed send records.** In `report-send.schema.ts`:

```ts
export type ReportSendKind = 'weekly' | 'monthly';
/** 'sending' is a claim in progress; 'sent' and 'skipped' are final. */
export type ReportSendStatus = 'sending' | 'sent' | 'skipped';
```

Type the props with `@Prop({ required: true, type: String }) kind: ReportSendKind;` and `@Prop({ required: true, type: String }) status: ReportSendStatus;`. Fix any comparison `tsc` then flags in `report-scheduler.service.ts` or `settings.service.ts`; they should already use these literals.

- [ ] **Step 3: Run the specs, the suite and the type check.**

Run: `cd api && npx jest src/reports src/settings && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and `tsc` prints nothing.

- [ ] **Step 4: Commit.**

```bash
git add api/src/reports api/src/shared/schemas/report-send.schema.ts
git commit -m "refactor(api): report month names live in one place; send records are typed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Shared helpers

**Files:**
- create `web/src/app/core/ui/focus.ts`;
- `web/src/app/pages/{categories,merchants,transactions}/*.component.ts`;
- `web/src/styles/_form-controls.scss`, plus the categories and merchants `.html`/`.scss`;
- create `api/src/test-utils/query-stub.ts`;
- `api/src/balance/balance.service.spec.ts`, `api/src/reports/report-data.service.spec.ts`.

- [ ] **Step 1: Web focus helper.** Create `web/src/app/core/ui/focus.ts`:

```ts
/**
 * After the next render, focuses the first of these element ids that exists.
 * `alive` lets a component skip it once destroyed.
 */
export function focusFirst(ids: string[], alive: () => boolean = () => true): void {
  setTimeout(() => {
    if (!alive()) return;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        return;
      }
    }
  }, 0);
}
```

Make the three copies call it:
- **Categories and Merchants:** the private `focus(...ids)` body becomes `focusFirst(ids, () => !this.destroyed);`.
- **Transactions:** `focusSoon(...ids)` becomes `focusFirst(ids);`.

Keep the private method names, so their callers don't change.

- [ ] **Step 2: One danger button.** In `web/src/styles/_form-controls.scss`, add:

```scss
.fc-btn--danger { background: var(--expense); border-color: var(--expense); color: var(--color-accent-ink);
  &:hover:not(:disabled) { opacity: 0.85; } }
```

Then:
- replace `cat-danger` with `fc-btn--danger` in `categories.component.html`, and delete `.cat-danger` from `categories.component.scss`;
- replace `mer-danger` with `fc-btn--danger` in `merchants.component.html`, and delete `.mer-danger` from `merchants.component.scss`.

- [ ] **Step 3: Api query stub.** Create `api/src/test-utils/query-stub.ts`:

```ts
/**
 * A chainable stand-in for a Mongoose query in unit tests: every chain method
 * returns the stub, and lean() / exec() resolve to `result`.
 */
export function queryStub<T>(result: T) {
  const q: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'populate']) q[m] = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(result));
  q.exec = jest.fn(() => Promise.resolve(result));
  return q as any;
}
```

In `balance.service.spec.ts` and `report-data.service.spec.ts`, delete the local `query` helper and `import { queryStub as query } from '../test-utils/query-stub';` (keep the local name, so nothing else changes).

- [ ] **Step 4: Run and build.**

Run: `cd api && npx jest && npx tsc --noEmit -p tsconfig.json && cd ../web && npx ng build && grep -rn "cat-danger\|mer-danger" src/app`
Expected: all tests pass, `tsc` is clean, the build is clean, and the grep prints nothing.

- [ ] **Step 5: Commit.**

```bash
git add web/src/app/core/ui/focus.ts web/src/app/pages/categories web/src/app/pages/merchants web/src/app/pages/transactions/transactions.component.ts web/src/styles/_form-controls.scss api/src/test-utils api/src/balance/balance.service.spec.ts api/src/reports/report-data.service.spec.ts
git commit -m "refactor: one focus helper, one danger button, one query stub for specs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Chart colours by formula

**Files:** `web/src/app/core/ui/chart-theme.ts`

- [ ] **Step 1: Replace the canvas converter.** In `chart-theme.ts`, delete `rgbCache`, `sharedCtx` and the canvas-based `toRgb`, and add this exported function in their place:

```ts
const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i;

/**
 * An oklch() colour as rgb()/rgba(), by the standard OKLab → linear sRGB → sRGB
 * formula. Chart.js's colour helper (used by plugins to add transparency) can't
 * parse oklch(); this needs no canvas, so anti-fingerprinting canvas noise can't
 * scramble the charts. Any other colour string is returned unchanged.
 */
export function toRgb(color: string): string {
  const m = OKLCH.exec(color.trim());
  if (!m) return color;
  const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963378 * a + 0.2158038 * b) ** 3;
  const mm = (L - 0.1055613 * a - 0.0638542 * b) ** 3;
  const s = (L - 0.0894842 * a - 1.2914855 * b) ** 3;
  const linear = [
    4.0767417 * l - 3.3077116 * mm + 0.2309699 * s,
    -1.268438 * l + 2.609757 * mm - 0.3413194 * s,
    -0.0041961 * l - 0.7034186 * mm + 1.7076147 * s,
  ];
  const [r, g, bl] = linear.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  if (m[5] === undefined) return `rgb(${r}, ${g}, ${bl})`;
  const alpha = m[6] ? Number(m[5]) / 100 : Number(m[5]);
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}
```

Update the file's top comment to say the tokens are converted by formula. `chartTheme()` keeps calling `toRgb(token(...))`.

- [ ] **Step 2: Check the values.** The canvas used to produce `rgb(0, 183, 193)` for the accent and `rgb(0, 229, 172)` for income. Run:

```bash
cd web && node -e "
const ts=require('typescript');const fs=require('fs');
const out=ts.transpileModule(fs.readFileSync('src/app/core/ui/chart-theme.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};new Function('module','exports',out)(m,m.exports);
for (const c of ['oklch(70%   0.14  200)','oklch(81%   0.18  168)','oklch(72%   0.18   25)','oklch(100%  0     0 / 7%)','#123456']) console.log(c,'->',m.exports.toRgb(c));"
```

Expected:
- accent `rgb(0, 183, 193)`, and income `rgb(0, 229, 172)`, each channel within ±1;
- the expense colour a red such as `rgb(255, 1xx, 1xx)`;
- the border `rgba(255, 255, 255, 0.07)`;
- `#123456` unchanged.

- [ ] **Step 3: Build.**

Run: `cd web && npx ng build`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add web/src/app/core/ui/chart-theme.ts
git commit -m "refactor(web): chart colours converted by formula, not by reading a canvas pixel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Reproducible images

**Files:** `api/Dockerfile`, `web/Dockerfile`

- [ ] **Step 1: api Dockerfile.** Replace the builder's first four instructions after `WORKDIR /app` with:

```dockerfile
# Pinned to the version that wrote pnpm-lock.yaml; --frozen-lockfile installs exactly
# the tested dependency versions and fails loudly if the lockfile is out of date.
RUN npm install -g pnpm@11.3.0
COPY package.json pnpm.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

If `api/.npmrc` exists, add it to that `COPY`. Leave the rest, including `COPY . .` and the build.

- [ ] **Step 2: web Dockerfile.** Change `RUN npm install -g pnpm` to `RUN npm install -g pnpm@11.3.0`.

- [ ] **Step 3: Prove the lockfile is in step.** In a throwaway copy, never in the repo's own `node_modules`:

```bash
TMP=$(mktemp -d) && cp api/package.json api/pnpm.json api/pnpm-lock.yaml api/pnpm-workspace.yaml "$TMP"/ && (cd "$TMP" && pnpm install --frozen-lockfile --ignore-scripts >/dev/null && echo FROZEN-OK); rm -rf "$TMP"
```

Expected: `FROZEN-OK`. If it fails with an outdated-lockfile error, STOP and report; don't regenerate the lockfile without asking.

- [ ] **Step 4: Commit.**

```bash
git add api/Dockerfile web/Dockerfile
git commit -m "build: api image installs from its lockfile; pnpm pinned in both images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller checklist

1. Run `cd api && npx jest` and `npx tsc --noEmit -p tsconfig.json`, then `cd web && npx ng build`.
2. Take preview-harness screenshots (fake api):
   - Recurring at 375 px with no horizontal scroll;
   - the brighter muted text;
   - the Merchants status under a changed row;
   - a huge Calculator result;
   - Balance "Loading…";
   - the review dropdown's keyboard behaviour, driven by synthetic key events;
   - "Load more" on Transactions and Balance using `before`;
   - chart colours unchanged after Task 12.
3. Run the final review, then the PII gate. Add "As built" and "Follow-ups" to this plan and the spec, and update memory.
4. Push, watch CI, and give the restart command.
5. Then run the project-wide `/code-review` the user asked for.

## As built (2026-09-25)

Tasks 1–13 landed in `7f2f28b`, `fecb4bb`, `d4039d8`, `c04a71a`, `111f41a`, `df98598`, `16c1e24`, `ef56eb2`, `443fba0`, `d5feb3c`, `7250cad`, `7c668ee` and `ba4bc7c`. Deviations:
- **Settings.** The DELETE routes answer the refreshed view, as the plan says.
- **Recurring retry.** A sweep that retries a failed month books only that month.
- **Report types.** They live in `report-types.ts`, and `reports.controller.spec.ts` changed too.
- **Chart colours.** The formula gives income's blue channel as 170, where the canvas gave 172, because Chrome gamut-maps instead of clipping.
- **The api Dockerfile** keeps `COPY . .` and the build step.

**Spec review** found gaps, all fixed in `ba92286` and `c8043b7`:
- Merchants: forgetting the last merchant showed no status.
- Tests were added for the offset fallback and total, the rendered month name, the Settings routes, and history with and without `seq`.
- The Recurring stylesheet went over the 8 kB warning budget, which is now 10 kB.
- The bot's schemas now mirror `seq` and `failedPeriod`.
- The chart's "Loading…" sits inside the chart box.
- Balance's filter resets the cursor.
- The calculator's "$1000T" edge now reads "over $999T".

**Quality review** caught 18 of 23 mutants. Fixed in `cc9e3e5` and `8392c8e`:
- **Guarded miss.** The spec's 1.9 extension to the guarded write's miss was reversed. That miss only happens while another tab's itemize is in flight, and repairing there could erase the reservation and allow over-itemizing. The miss now re-reads and reports the real reason: a 400 naming what's itemized, or the 409. The pre-check still repairs a genuinely stuck counter.
- **Tests.** Sort key order is pinned, as is offset together with a cursor.
- **History total.** It is counted before the cursor, so it stays stable while paging.
- **Unreadable mails** are forgotten only when a start date is configured. The rolling 24-hour window would drop them a day after arrival.
- **`failedPeriod`** is recorded only for a month not yet handled, which covers two pods sweeping at once.
- **Web:**
  - typing a letter on a review dropdown waits like the arrows do;
  - Transactions ignores stale "Load more" replies;
  - the Merchants status falls back to the top when its row is filtered out.

**Preview harness** (fake data) confirmed:
- Recurring at 375 px has no horizontal scroll;
- the muted text is brighter;
- the Merchants status appears under the changed row, and after a forget under the row that took its place;
- the calculator shows "$2.8T" and "over $999T";
- the dropdown keys behave as designed (arrow and change file nothing, blur files, Escape restores, Enter files, a mouse change files);
- "Load more" pages by `before` (20 → 40 → 45) on Transactions and by `s81` on Balance;
- the Balance chart shows "Loading…".

Final: api 68 suites / 830 tests, `tsc` clean, web build clean with no warnings, and `--frozen-lockfile` passes for api and web.

## Follow-ups

- **A permanently failing recurring rule** (for example an unknown type) now retries every hour for good, where before it aged out after 31 days. Its error log is the signal.
- **A cash-panel reply that lands after a list reload or a reopen** can be lost, or counted twice in the row's figure, until the next reload.
- **Daily closings sort by timestamp first.** Two concurrent writes stamped in reverse order across midnight could close a day on the earlier one.
- **The api image still ships devDependencies.**
- **Four focus-helper copies remain** (cash panel and the Settings sections), beyond the three the spec named.
