# Cash Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ATM withdrawal be itemized on the web into the categories the cash went to, so every per-category view counts it there, with no double counting and no effect on the balance.

**Architecture:**
- Items live in a new `CashAllocation` collection.
- A withdrawal carries an `allocatedCash` reservation counter that only guarded writes change, which blocks over-itemizing without transactions.
- A pure `rollUpByCategory` function, wrapped by `CategorySpendService`, is the one place spending is grouped by category. Budget, Statistics, the weekly email, Compare and Tips all call it.
- `cash` becomes a reserved built-in category; new withdrawals are ingested into it.

**Tech Stack:**
- api: NestJS 10, Mongoose 8, Jest, pnpm.
- web: Angular 17 standalone, pnpm. It has no test runner, so it is verified by a clean build with zero warnings and no colour literals in stylesheets.

**Spec:** `docs/superpowers/specs/2026-09-23-cash-envelopes-design.md` (revised 2026-09-24).

---

## Ground rules for every task

- **Paths.** Repo root: `C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot`. Use Git Bash, and `cd` with an absolute path in every command.
- **Branch.** Work on `main`; the user works trunk-based. **Never push, amend, rebase or reset.**
- **Staging.** `git add <explicit paths>` only, never `-A` or `.`.
- **Commits.** Every message ends with a blank line and exactly one trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo.** Test data is generic: no real names, accounts, emails or transaction ids.
- **Baseline.** Before Task 1, the api has **42 suites / 432 tests**, all passing. Each task states the expected counts after it.
- **Single-node MongoDB, no multi-document transactions.** Every multi-step write is ordered so that an interruption leaves a *fail-safe* state. Keep the orders exactly as written.
- **One allowed spec deviation.** The spec says the web page calls `TransactionEventsService.notify()` after an item change; the page does **not**. The list would reload, and under the "Unitemized cash" filter it would drop the row whose panel is open. Nothing on screen at the same time shows category totals, and Budget, Statistics and the Dashboard load fresh on every visit (no route reuse). The As-built notes record this.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/shared/schemas/category.enum.ts` | modify | adds `CASH = 'cash'` |
| `api/src/categories/categories.service.ts` | modify | `cash` in `BUILT_IN`; `totalUses` in `remove()` |
| `web/src/app/core/services/category.service.ts` | modify | `cash` colour and icon |
| `api/src/shared/schemas/cash-allocation.schema.ts` | create | the item document |
| `api/src/shared/schemas/transaction.schema.ts` | modify | `allocatedCash?: number` |
| `api/src/cash/cash-rules.ts` | create | `HALF_CENT`, `round2`, `money` |
| `api/src/cash/category-rollup.ts` | create | pure `rollUpByCategory` |
| `api/src/cash/category-spend.service.ts` | create | loads rows and items, calls the rollup |
| `api/src/cash/cash.service.ts` | create | breakdown, add (guarded reservation), remove |
| `api/src/cash/cash.controller.ts` | create | `/cash/...` routes |
| `api/src/cash/cash.module.ts` | create | wires the above; exports `CategorySpendService` |
| `api/src/budget/*`, `statistics/*`, `reports/report-data.service.ts`, `reports/reports.module.ts`, `compare/*`, `tips/*` | modify | read categories from `CategorySpendService` |
| `api/src/transactions/transactions.{service,controller}.ts` | modify | list fields, `unitemized` filter, the amount-edit guard |
| `api/src/categories/category-references.service.ts`, `categories.module.ts` | modify | cash items in usage and moves |
| `api/src/ingestion/ingestion.service.ts`, `categorizer.service.ts` | modify | withdrawals booked as `cash` |
| `web/src/app/core/services/api.{models,service}.ts` | modify | types and calls |
| `web/src/app/pages/transactions/transactions.component.{ts,html,scss}` | modify | the filter and the itemize panel |
| `web/src/app/pages/categories/categories.component.ts` | modify | cash items in usage text |
| `README.md` | modify | feature row and endpoints |

---

### Task 1: `cash` becomes a built-in category

**Files:**
- Modify: `api/src/shared/schemas/category.enum.ts`
- Modify: `api/src/categories/categories.service.ts` (the `BUILT_IN` list at the top)
- Modify: `web/src/app/core/services/category.service.ts` (`BUILT_IN` map)
- Test: `api/src/categories/category-rules.spec.ts`, `api/src/categories/categories.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `category-rules.spec.ts`, in the test `'reserves every built-in name'`, change the array to:
```ts
    for (const name of ['food', 'transport', 'housing', 'health', 'entertainment', 'salary', 'savings', 'other', 'cash']) {
```

In `categories.service.spec.ts`:
- add `import { Category } from '../shared/schemas/category.enum';` to the imports;
- add this `describe` directly before `describe('assertValid'`:
```ts
  describe('list', () => {
    it('offers every built-in category, cash included, before the custom ones', async () => {
      const names = (await service.list()).map((c) => c.name);
      expect(names).toEqual([...Object.values(Category), 'Gym']);
    });
  });
```
- in the overview test `'lists built-ins first, then custom by name, with usage, palette and emoji'`, change `o.categories.slice(8)` to `o.categories.slice(9)`, since there are now nine built-ins.

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- categories 2>&1 | tail -30
```
Expected failures: `reserves every built-in name` (`cash` isn't reserved), `offers every built-in category…` (no `cash`), and the overview test (`slice(9)` misses the first custom row).

- [ ] **Step 3: Implement**

`api/src/shared/schemas/category.enum.ts`: add `CASH = 'cash',` after `OTHER = 'other',`:
```ts
export enum Category {
  FOOD = 'food',
  TRANSPORT = 'transport',
  HOUSING = 'housing',
  HEALTH = 'health',
  ENTERTAINMENT = 'entertainment',
  SALARY = 'salary',
  SAVINGS = 'savings',
  OTHER = 'other',
  /** An ATM withdrawal's cash not yet itemized (see api/src/cash). */
  CASH = 'cash',
}
```

`api/src/categories/categories.service.ts`: add the last line of `BUILT_IN`:
```ts
  { name: 'other',         color: '#94a3b8', emoji: '📦' },
  { name: 'cash',          color: '#84cc16', emoji: '💵' },
];
```

`web/src/app/core/services/category.service.ts`: add the last entry of `BUILT_IN`:
```ts
    other:         { color: '#94a3b8', icon: 'receipt_long'     },
    cash:          { color: '#84cc16', icon: 'local_atm'        },
  };
```

- [ ] **Step 4: Run the suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: **42 suites / 433 tests**, all passing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/category.enum.ts api/src/categories/categories.service.ts api/src/categories/categories.service.spec.ts api/src/categories/category-rules.spec.ts web/src/app/core/services/category.service.ts
git commit -F- <<'EOF'
feat(api,web): cash joins the built-in categories

A withdrawal's cash that isn't itemized yet will live under it. Being a
built-in, the name is reserved for custom categories.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The item schema and the withdrawal's reservation counter

**Files:**
- Create: `api/src/shared/schemas/cash-allocation.schema.ts`
- Create: `api/src/shared/schemas/cash-allocation.schema.spec.ts`
- Modify: `api/src/shared/schemas/transaction.schema.ts`
- Test: `api/src/shared/schemas/transaction.schema.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/shared/schemas/cash-allocation.schema.spec.ts`:
```ts
import { CashAllocationSchema } from './cash-allocation.schema';

describe('CashAllocationSchema', () => {
  // Every read goes through a withdrawal: its breakdown, and the rollup's $in over a period's withdrawals.
  it('indexes items by (userId, withdrawalId)', () => {
    expect(CashAllocationSchema.indexes()).toContainEqual([{ userId: 1, withdrawalId: 1 }, expect.anything()]);
  });
});
```

Append to `api/src/shared/schemas/transaction.schema.spec.ts`:
```ts

describe('TransactionSchema fields', () => {
  it('declares allocatedCash, the itemized-cash reservation of a withdrawal', () => {
    expect(TransactionSchema.path('allocatedCash')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- schemas 2>&1 | tail -20
```
Expected: the new spec fails to compile (no module `./cash-allocation.schema`), and `declares allocatedCash` fails (path undefined).

- [ ] **Step 3: Implement**

Create `api/src/shared/schemas/cash-allocation.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * One line of an itemized ATM withdrawal: how much of its cash went to which
 * category. It carries category weight only. The withdrawal (a Transaction)
 * keeps the total and already moved the balance.
 *
 * `amount` is a POSITIVE magnitude, unlike Transaction.amount, which stores
 * expenses as negative numbers.
 */
@Schema()
export class CashAllocation extends Document {
  @Prop({ required: true }) userId: number;
  /** The withdrawal's Transaction._id, as a string. */
  @Prop({ required: true }) withdrawalId: string;
  @Prop({ required: true }) category: string;
  @Prop({ required: true }) amount: number;
  @Prop() description?: string;
  @Prop({ required: true, default: Date.now }) createdAt: Date;
}

export const CashAllocationSchema = SchemaFactory.createForClass(CashAllocation);

CashAllocationSchema.index({ userId: 1, withdrawalId: 1 });
```

In `api/src/shared/schemas/transaction.schema.ts`, directly after `@Prop() isWithdrawal?: boolean;`, add:
```ts

  /**
   * Withdrawals only: the sum of this withdrawal's CashAllocation items. It is a
   * reservation counter that only guarded writes change (see CashService), and it
   * guards against itemizing more than was withdrawn. Totals read the items, never this.
   */
  @Prop() allocatedCash?: number;
```

- [ ] **Step 4: Run the suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: **43 suites / 435 tests**, all passing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/cash-allocation.schema.ts api/src/shared/schemas/cash-allocation.schema.spec.ts api/src/shared/schemas/transaction.schema.ts api/src/shared/schemas/transaction.schema.spec.ts
git commit -F- <<'EOF'
feat(api): cash items, and a withdrawal's itemized-cash counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The pure rollup

**Files:**
- Create: `api/src/cash/cash-rules.ts`
- Create: `api/src/cash/category-rollup.ts`
- Test: `api/src/cash/category-rollup.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/cash/category-rollup.spec.ts`:
```ts
import { ItemRow, SpendRow, rollUpByCategory } from './category-rollup';

const withdrawal = (id: string, amount: number, category = 'cash'): SpendRow => ({ id, amount: -amount, category, isWithdrawal: true });
const expense = (id: string, amount: number, category?: string): SpendRow => ({ id, amount: -amount, category });
const item = (withdrawalId: string, category: string, amount: number): ItemRow => ({ withdrawalId, category, amount });

describe('rollUpByCategory', () => {
  it('splits a withdrawal into its items and leaves the rest in cash (the worked example)', () => {
    expect(rollUpByCategory([withdrawal('w1', 5000)], [item('w1', 'food', 3000), item('w1', 'transport', 1500)])).toEqual([
      { category: 'food', total: 3000 },
      { category: 'transport', total: 1500 },
      { category: 'cash', total: 500 },
    ]);
  });

  it('adds items to the same category as card spending', () => {
    expect(rollUpByCategory([expense('t1', 200, 'food'), withdrawal('w1', 1000)], [item('w1', 'food', 300)])).toEqual([
      { category: 'cash', total: 700 },
      { category: 'food', total: 500 },
    ]);
  });

  it('counts a withdrawal with no items in full under its own category', () => {
    expect(rollUpByCategory([withdrawal('w1', 800)], [])).toEqual([{ category: 'cash', total: 800 }]);
  });

  it('leaves no cash row for a fully itemized withdrawal', () => {
    expect(rollUpByCategory([withdrawal('w1', 800)], [item('w1', 'food', 800)])).toEqual([{ category: 'food', total: 800 }]);
  });

  it("keeps an older withdrawal's remainder in its own category", () => {
    expect(rollUpByCategory([withdrawal('w1', 1000, 'other')], [item('w1', 'health', 400)])).toEqual([
      { category: 'other', total: 600 },
      { category: 'health', total: 400 },
    ]);
  });

  it('ignores items whose withdrawal is not among the rows', () => {
    expect(rollUpByCategory([expense('t1', 100, 'food')], [item('gone', 'food', 999)])).toEqual([{ category: 'food', total: 100 }]);
  });

  it('never itemizes a row that is not a withdrawal', () => {
    expect(rollUpByCategory([expense('t1', 100, 'food')], [item('t1', 'health', 60)])).toEqual([{ category: 'food', total: 100 }]);
  });

  it('adds up to the total spending', () => {
    const rows = [expense('t1', 120.55, 'food'), withdrawal('w1', 3000), expense('t2', 99.45), withdrawal('w2', 500, 'other')];
    const items = [item('w1', 'food', 1000.1), item('w1', 'transport', 250.25), item('w2', 'health', 500)];
    const sum = rollUpByCategory(rows, items).reduce((s, c) => s + c.total, 0);
    expect(Math.round(sum * 100) / 100).toBe(3720);
  });

  it('files a row without a category under other, rounds to cents, and sorts by total then name', () => {
    expect(rollUpByCategory([expense('t1', 33.333), expense('t2', 5, 'b'), expense('t3', 5, 'a')], [])).toEqual([
      { category: 'other', total: 33.33 },
      { category: 'a', total: 5 },
      { category: 'b', total: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-rollup 2>&1 | tail -10
```
Expected: FAIL. The module `./category-rollup` isn't found.

- [ ] **Step 3: Implement**

Create `api/src/cash/cash-rules.ts`:
```ts
/** Absorbs the floating-point drift `$inc` accumulates in a sum of cents. */
export const HALF_CENT = 0.005;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 4500 → "$4,500.00", the web's money format. */
export const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
```

Create `api/src/cash/category-rollup.ts`:
```ts
import { round2 } from './cash-rules';

/** A spending row: a Transaction with amount < 0 (expenses are stored negative). */
export interface SpendRow {
  id: string;
  amount: number;
  category?: string | null;
  isWithdrawal?: boolean;
}

/** One itemized line of a withdrawal. `amount` is a POSITIVE magnitude, unlike SpendRow.amount. */
export interface ItemRow {
  withdrawalId: string;
  amount: number;
  category: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

/**
 * Spending per category with cash itemization applied:
 * - a withdrawal's own category gets |amount| minus the sum of its items (never below 0);
 * - each item's category gets the item's amount;
 * - every other row counts in full.
 * The totals therefore still add up to the rows' total spending.
 */
export function rollUpByCategory(rows: SpendRow[], items: ItemRow[]): CategoryTotal[] {
  const withdrawals = new Set(rows.filter((r) => r.isWithdrawal).map((r) => r.id));
  const itemized = new Map<string, number>();
  const totals = new Map<string, number>();
  const add = (category: string, amount: number) => totals.set(category, (totals.get(category) ?? 0) + amount);

  for (const it of items) {
    if (!withdrawals.has(it.withdrawalId)) continue; // its withdrawal is deleted, outside the period, or not spending
    itemized.set(it.withdrawalId, (itemized.get(it.withdrawalId) ?? 0) + it.amount);
    add(it.category, it.amount);
  }
  for (const row of rows) {
    const spent = Math.abs(row.amount);
    add(row.category || 'other', row.isWithdrawal ? Math.max(0, spent - (itemized.get(row.id) ?? 0)) : spent);
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total: round2(total) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}
```

- [ ] **Step 4: Run the suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: **44 suites / 444 tests**, all passing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/cash/cash-rules.ts api/src/cash/category-rollup.ts api/src/cash/category-rollup.spec.ts
git commit -F- <<'EOF'
feat(api): roll spending up by category with cash itemization applied

A withdrawal's own category keeps only what isn't itemized; each item
counts under its category; the totals still add up to total spending.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `CategorySpendService` and the first cut of `CashModule`

**Files:**
- Create: `api/src/cash/category-spend.service.ts`
- Create: `api/src/cash/cash.module.ts`
- Test: `api/src/cash/category-spend.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/cash/category-spend.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CategorySpendService } from './category-spend.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const FROM = new Date('2026-09-01T04:00:00Z');
const TO = new Date('2026-10-01T04:00:00Z');

describe('CategorySpendService', () => {
  let service: CategorySpendService;
  let txModel: { find: jest.Mock };
  let itemModel: { find: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { find: jest.fn(() => query([])) };
    itemModel = { find: jest.fn(() => query([])) };
    const mod = await Test.createTestingModule({
      providers: [
        CategorySpendService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
      ],
    }).compile();
    service = mod.get(CategorySpendService);
  });

  it("reads the period's spending rows only", async () => {
    await service.byCategory(FROM, TO);
    expect(txModel.find).toHaveBeenCalledWith({
      userId: 1,
      timestamp: { $gte: FROM, $lt: TO },
      amount: { $lt: 0 },
      ...SPENDING_ONLY,
    });
  });

  it("reads only the items of the period's withdrawals, and applies them", async () => {
    txModel.find.mockReturnValue(
      query([
        { _id: 'w1', amount: -5000, category: 'cash', isWithdrawal: true },
        { _id: 't1', amount: -200, category: 'food' },
      ]),
    );
    itemModel.find.mockReturnValue(
      query([
        { withdrawalId: 'w1', amount: 3000, category: 'food' },
        { withdrawalId: 'w1', amount: 1500, category: 'transport' },
      ]),
    );
    const totals = await service.byCategory(FROM, TO);
    expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: { $in: ['w1'] } });
    expect(totals).toEqual([
      { category: 'food', total: 3200 },
      { category: 'transport', total: 1500 },
      { category: 'cash', total: 500 },
    ]);
  });

  it('skips the item query when the period has no withdrawals', async () => {
    txModel.find.mockReturnValue(query([{ _id: 't1', amount: -200, category: 'food' }]));
    expect(await service.byCategory(FROM, TO)).toEqual([{ category: 'food', total: 200 }]);
    expect(itemModel.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-spend 2>&1 | tail -10
```
Expected: FAIL. The module `./category-spend.service` isn't found.

- [ ] **Step 3: Implement**

Create `api/src/cash/category-spend.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { CategoryTotal, rollUpByCategory } from './category-rollup';

/**
 * The one answer to "how much went to each category" between two instants.
 * Every per-category view asks here, so cash itemization reaches all of them
 * the same way: budgets, statistics, the emails, compare and tips.
 */
@Injectable()
export class CategorySpendService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
  ) {}

  /** Spending per category from `from` (inclusive) to `to` (exclusive), largest first. */
  async byCategory(from: Date, to: Date): Promise<CategoryTotal[]> {
    const txs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: from, $lt: to }, amount: { $lt: 0 }, ...SPENDING_ONLY })
      .select('amount category isWithdrawal')
      .lean();
    const rows = txs.map((t) => ({ id: String(t._id), amount: t.amount, category: t.category, isWithdrawal: t.isWithdrawal }));

    // Items of deleted or non-spending withdrawals never load: only this period's live spending rows are asked for.
    const withdrawalIds = rows.filter((r) => r.isWithdrawal).map((r) => r.id);
    const items = withdrawalIds.length
      ? await this.itemModel
          .find({ userId: this.userId, withdrawalId: { $in: withdrawalIds } })
          .select('withdrawalId amount category')
          .lean()
      : [];

    return rollUpByCategory(rows, items);
  }
}
```

Create `api/src/cash/cash.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';
import { CategorySpendService } from './category-spend.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: CashAllocation.name, schema: CashAllocationSchema },
    ]),
  ],
  providers: [CategorySpendService],
  exports: [CategorySpendService],
})
export class CashModule {}
```

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **45 suites / 447 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/cash/category-spend.service.ts api/src/cash/category-spend.service.spec.ts api/src/cash/cash.module.ts
git commit -F- <<'EOF'
feat(api): one service answers spending per category, cash items included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The five per-category views read `CategorySpendService`

**Files:**
- Modify: `api/src/budget/budget.service.ts`, `api/src/budget/budget.module.ts`, `api/src/budget/budget.service.spec.ts`
- Modify: `api/src/statistics/statistics.service.ts`, `api/src/statistics/statistics.module.ts`, `api/src/statistics/statistics.service.spec.ts`
- Modify: `api/src/reports/report-data.service.ts`, `api/src/reports/reports.module.ts`, `api/src/reports/report-data.service.spec.ts`
- Modify: `api/src/compare/compare.service.ts`, `api/src/compare/compare.module.ts`, `api/src/compare/compare.service.spec.ts`
- Modify: `api/src/tips/tips.service.ts`, `api/src/tips/tips.module.ts`, `api/src/tips/tips.service.spec.ts`

Every module below adds `CashModule` (`import { CashModule } from '../cash/cash.module';`) to its `imports`. `ReportsModule` needs it directly, not only through `StatisticsModule` and `BudgetModule`, because Nest doesn't re-export providers transitively.

- [ ] **Step 1: Rewire the tests first (they fail until Step 2)**

**`budget.service.spec.ts`**
- Remove the `mockTransactionModel` constant, its provider line, the `Transaction` and `SPENDING_ONLY` imports (if nothing else uses them), and its `jest.fn` resets.
- Add:
```ts
import { CategorySpendService } from '../cash/category-spend.service';

const mockSpend = { byCategory: jest.fn() };
```
- Add the provider `{ provide: CategorySpendService, useValue: mockSpend },`.
- In `beforeEach`, after `jest.clearAllMocks()`, add `mockSpend.byCategory.mockResolvedValue([]);`.
- Replace the `get` describe's test with:
```ts
    it("takes each budget's spent from CategorySpendService, for the month asked", async () => {
      mockBudgetModel.lean.mockResolvedValueOnce([
        { category: 'housing', limitAmount: 20000 },
        { category: 'food', limitAmount: 5000 },
      ]);
      mockSpend.byCategory.mockResolvedValueOnce([{ category: 'food', total: 3200 }, { category: 'cash', total: 500 }]);
      const rows = await service.get(8, 2026);
      expect(mockSpend.byCategory).toHaveBeenCalledWith(new Date(2026, 7, 1), new Date(2026, 8, 1));
      expect(rows).toEqual([
        { category: 'housing', limit: 20000, spent: 0, remaining: 20000, percentage: 0, month: 8, year: 2026 },
        { category: 'food', limit: 5000, spent: 3200, remaining: 1800, percentage: 64, month: 8, year: 2026 },
      ]);
    });
```

**`statistics.service.spec.ts`**
- Add:
```ts
import { CategorySpendService } from '../cash/category-spend.service';

const spend = { byCategory: jest.fn() };
```
- Add the provider `{ provide: CategorySpendService, useValue: spend },` and, after `jest.clearAllMocks()`, `spend.byCategory.mockResolvedValue([]);`.
- Replace the `byCategory` describe's test with:
```ts
    it("returns CategorySpendService's breakdown for the month asked", async () => {
      spend.byCategory.mockResolvedValueOnce([{ category: 'food', total: 3200 }]);
      expect(await service.byCategory(8, 2026)).toEqual([{ category: 'food', total: 3200 }]);
      expect(spend.byCategory).toHaveBeenCalledWith(new Date(2026, 7, 1), new Date(2026, 8, 1));
    });
```

**`report-data.service.spec.ts`**
- Add `import { CategorySpendService } from '../cash/category-spend.service';`.
- Add `let spend: { byCategory: jest.Mock };` next to the other `let`s; in `beforeEach`, `spend = { byCategory: jest.fn().mockResolvedValue([]) };` and the provider `{ provide: CategorySpendService, useValue: spend },`.
- In `'totals the week, ranks its categories and its largest expenses'`, add before `const { week } = …`:
```ts
      spend.byCategory.mockResolvedValueOnce([
        { category: 'housing', total: 12000 },
        { category: 'other', total: 300 },
        { category: 'food', total: 150 },
      ]);
```
  and after the `topCategories` expectation: `expect(spend.byCategory).toHaveBeenCalledWith(WEEK.from, WEEK.to);`.
- Replace the body of `'keeps only the top 5 categories'` with:
```ts
      spend.byCategory.mockResolvedValueOnce(
        ['g', 'f', 'e', 'd', 'c', 'b', 'a'].map((category, i) => ({ category, total: (7 - i) * 10 })),
      );
      const { week } = await service.weekly(WEEK, NOW);
      expect(week.topCategories.map((c) => c.category)).toEqual(['g', 'f', 'e', 'd', 'c']);
```

**`compare.service.spec.ts`**
- Add:
```ts
import { CategorySpendService } from '../cash/category-spend.service';

const spend = { byCategory: jest.fn() };
```
- Add the provider `{ provide: CategorySpendService, useValue: spend },` and, after `jest.clearAllMocks()`, `spend.byCategory.mockResolvedValue([{ category: 'food', total: 250 }, { category: 'transport', total: 150 }]);`.
- In `'returns top categories sorted by amount descending'`, add `expect(spend.byCategory).toHaveBeenCalledWith(new Date(2026, 4, 1), new Date(2026, 5, 1));`.
- Replace `'includes at most 3 top categories'` with:
```ts
    it('includes at most 3 top categories', async () => {
      spend.byCategory.mockResolvedValue(['a', 'b', 'c', 'd'].map((category, i) => ({ category, total: 100 - i })));
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.topCategories).toEqual([
        { category: 'a', amount: 100 },
        { category: 'b', amount: 99 },
        { category: 'c', amount: 98 },
      ]);
    });
```

**`tips.service.spec.ts`**
- Add:
```ts
import { CategorySpendService } from '../cash/category-spend.service';

const spend = { byCategory: jest.fn() };
```
- Add the provider `{ provide: CategorySpendService, useValue: spend },` and, after `jest.clearAllMocks()`, `spend.byCategory.mockResolvedValue([]);`.
- Replace `'excludes deleted rows and internal/unresolved transfers from the 3-month category breakdown query'` (the comment above it included) with:
```ts
    it("reads each of the last 3 months' categories from CategorySpendService", async () => {
      await service.getTips();
      expect(spend.byCategory).toHaveBeenCalledTimes(3);
      const now = new Date();
      for (let i = 2; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        expect(spend.byCategory).toHaveBeenCalledWith(start, new Date(start.getFullYear(), start.getMonth() + 1, 1));
      }
    });
```

Run them and see them fail:
```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- budget statistics report-data compare tips 2>&1 | grep -E "✕|Tests:"
```
Expected: the rewired and new tests fail, because nothing calls `byCategory` yet.

- [ ] **Step 2: Implement**

**`budget.service.ts`**
- Remove the `Transaction` and `SPENDING_ONLY` imports and the `transactionModel` constructor parameter.
- Add `import { CategorySpendService } from '../cash/category-spend.service';` and the constructor parameter `private readonly spend: CategorySpendService,` after `categories`.
- Replace everything in `get()` from `const start = …` to the end of the method with:
```ts
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    // Itemized cash counts toward its category's budget (see CategorySpendService).
    const spentBy = new Map((await this.spend.byCategory(start, end)).map((c) => [c.category, c.total]));

    return budgets.map((b) => {
      const spent = spentBy.get(b.category) ?? 0;
      return {
        category: b.category,
        limit: b.limitAmount,
        spent,
        remaining: Math.round((b.limitAmount - spent) * 100) / 100,
        percentage: Math.min(100, Math.round((spent / b.limitAmount) * 100)),
        month: m,
        year: y,
      };
    });
```
`budget.module.ts`: remove the `Transaction` entry from `forFeature` (and its import), and add `CashModule` to `imports`.

**`statistics.service.ts`**
- Add the import and the constructor parameter `private readonly spend: CategorySpendService,`.
- Replace `byCategory` with:
```ts
  /** Expense breakdown by category for a month, cash itemization applied. */
  async byCategory(month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    return this.spend.byCategory(new Date(y, m - 1, 1), new Date(y, m, 1));
  }
```
`statistics.module.ts`: add `CashModule` to `imports`.

**`report-data.service.ts`**
- Add the import and the constructor parameter `private readonly spend: CategorySpendService,` last.
- In `weekly()`, replace the `byCategory` map, its loop and the `topCategories` computation with:
```ts
    // Itemized cash counts under its categories (see CategorySpendService); the week's total is unchanged.
    const topCategories: CategoryTotal[] = (await this.spend.byCategory(period.from, period.to)).slice(0, 5);
```
`reports.module.ts`: add `CashModule` to `imports`.

**`compare.service.ts`**
- Add the import and the constructor parameter `private readonly spend: CategorySpendService,` after `txModel`.
- Replace `buildPeriodSummary`'s body from `const txs = …` to the `return` with:
```ts
    const [txs, categories] = await Promise.all([
      this.txModel
        .find({
          userId: this.userId,
          timestamp: { $gte: start, $lt: end },
          ...SPENDING_ONLY,
        })
        .select('amount')
        .lean(),
      this.spend.byCategory(start, end),
    ]);

    const totalIncome   = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const topCategories = categories.slice(0, 3).map(({ category, total }) => ({ category, amount: total }));

    return { month, totalIncome, totalExpenses, net: totalIncome - totalExpenses, topCategories };
```
`compare.module.ts`: add `CashModule` to `imports`.

**`tips.service.ts`**
- Add the import and the constructor parameter `private readonly spend: CategorySpendService,` after `txModel`.
- Replace the `for` loop in `buildSpendingContext` with:
```ts
    // Last 3 calendar months of expenses by category, cash itemization applied
    for (let i = 2; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const label = start.toLocaleString('en', { month: 'long', year: 'numeric' });

      const lines = (await this.spend.byCategory(start, end))
        .map(({ category, total }) => `  ${category}: $${total.toFixed(2)}`)
        .join('\n');

      blocks.push(`${label}:\n${lines || '  (no expenses recorded)'}`);
    }
```
`tips.module.ts`: add `CashModule` to `imports`.

- [ ] **Step 3: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **45 suites / 447 tests** (tests were replaced, not added), all passing; the build is clean. Then confirm no per-category grouping is left outside the rollup:
```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git grep -nE "t\.category \|\| 'other'" -- api/src
```
Expected: only `api/src/transactions/transactions.service.ts` (the CSV export, which lists rows as booked).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/budget api/src/statistics api/src/reports/report-data.service.ts api/src/reports/report-data.service.spec.ts api/src/reports/reports.module.ts api/src/compare api/src/tips
git status --short
git commit -F- <<'EOF'
refactor(api): every per-category view reads CategorySpendService

Budgets, statistics (and the monthly email), the weekly email, compare
and tips no longer group transactions themselves, so itemized cash
reaches all five the same way.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
(`git status --short` must be clean before the commit except for the staged files; stop if anything outside these folders is modified.)

---

### Task 6: Itemizing: `CashService`, `CashController`, wiring

**Files:**
- Create: `api/src/cash/cash.service.ts`
- Create: `api/src/cash/cash.controller.ts`
- Modify: `api/src/cash/cash.module.ts`, `api/src/app.module.ts`
- Test: `api/src/cash/cash.service.spec.ts`, `api/src/transactions/transactions.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/cash/cash.service.spec.ts`:
```ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashService } from './cash.service';
import { CashModule } from './cash.module';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { LedgerService } from '../shared/ledger/ledger.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { CategoriesService } from '../categories/categories.service';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

const W = '64b0000000000000000000a1';
const ITEM = '64b0000000000000000000b1';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { sort: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const withdrawal = (over: Record<string, unknown> = {}) => ({
  _id: W, userId: 1, transactionName: 'cajero automatico', timestamp: new Date('2026-09-20T15:00:00Z'),
  amount: -5000, isWithdrawal: true, allocatedCash: 4500, ...over,
});

describe('CashService', () => {
  let service: CashService;
  let txModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
  let itemModel: { find: jest.Mock; create: jest.Mock; findOneAndDelete: jest.Mock };
  let categories: { assertValid: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = {
      findOne: jest.fn(() => query(withdrawal())),
      findOneAndUpdate: jest.fn().mockResolvedValue(withdrawal()),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    itemModel = {
      find: jest.fn(() => query([])),
      create: jest.fn().mockResolvedValue({ _id: ITEM }),
      findOneAndDelete: jest.fn(() => query(null)),
    };
    categories = {
      assertValid: jest.fn(async (c: string) => {
        if (!['food', 'transport', 'cash'].includes(c)) throw new BadRequestException(`unknown category: ${c}`);
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CashService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
        { provide: CategoriesService, useValue: categories },
      ],
    }).compile();
    service = mod.get(CashService);
  });

  describe('breakdown', () => {
    it("computes what's allocated and left from the items, oldest first", async () => {
      const items = query([
        { _id: 'i1', category: 'food', amount: 3000, description: 'groceries' },
        { _id: 'i2', category: 'transport', amount: 1500 },
      ]);
      itemModel.find.mockReturnValue(items);
      expect(await service.breakdown(W)).toEqual({
        id: W, name: 'cajero automatico', timestamp: new Date('2026-09-20T15:00:00Z'),
        amount: 5000, allocated: 4500, remaining: 500,
        items: [
          { id: 'i1', category: 'food', description: 'groceries', amount: 3000 },
          { id: 'i2', category: 'transport', description: null, amount: 1500 },
        ],
      });
      expect(txModel.findOne).toHaveBeenCalledWith({ _id: W, userId: 1, deletedAt: null });
      expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: W });
      expect(items.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    });

    it('is a 404 for a missing or deleted row, or anything but a spending withdrawal', async () => {
      txModel.findOne.mockReturnValueOnce(query(null));
      await expect(service.breakdown(W)).rejects.toThrow(NotFoundException);
      await expect(service.breakdown('nope')).rejects.toThrow(NotFoundException);
      txModel.findOne.mockReturnValueOnce(query(withdrawal({ isWithdrawal: false })));
      await expect(service.breakdown(W)).rejects.toThrow(NotFoundException);
    });
  });

  describe('add', () => {
    it('reserves the amount on the withdrawal in one guarded write, then records the item', async () => {
      await expect(service.add(W, { category: 'food', amount: 300, description: '  groceries ' })).resolves.toEqual({ id: ITEM });
      expect(txModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: W, userId: 1, isWithdrawal: true, amount: { $lt: 0 }, ...SPENDING_ONLY,
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ['$allocatedCash', 0] }, 300] },
              { $add: [{ $abs: '$amount' }, 0.005] },
            ],
          },
        },
        { $inc: { allocatedCash: 300 } },
        { new: true },
      );
      expect(itemModel.create).toHaveBeenCalledWith({ userId: 1, withdrawalId: W, category: 'food', amount: 300, description: 'groceries' });
      expect(txModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(itemModel.create.mock.invocationCallOrder[0]);
    });

    it('rounds the amount to cents and drops an empty description', async () => {
      await service.add(W, { category: 'food', amount: 12.3456, description: '   ' });
      expect(itemModel.create).toHaveBeenCalledWith({ userId: 1, withdrawalId: W, category: 'food', amount: 12.35 });
    });

    it('refuses more than is left, naming what is left, and records nothing', async () => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
      expect(itemModel.create).not.toHaveBeenCalled();
    });

    it('is a 404 for a missing or deleted withdrawal', async () => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      txModel.findOne.mockReturnValueOnce(query(null));
      await expect(service.add(W, { category: 'food', amount: 10 })).rejects.toThrow(NotFoundException);
      await expect(service.add('nope', { category: 'food', amount: 10 })).rejects.toThrow(NotFoundException);
      expect(itemModel.create).not.toHaveBeenCalled();
    });

    it.each([
      ['an ordinary expense', { isWithdrawal: false }],
      ['an internal transfer', { transferKind: 'internal' }],
      ['an unresolved transfer', { transferKind: 'unresolved' }],
      ['money coming in', { amount: 5000 }],
    ])('refuses to itemize %s', async (_label, over) => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      txModel.findOne.mockReturnValueOnce(query(withdrawal(over)));
      await expect(service.add(W, { category: 'food', amount: 10 })).rejects.toThrow('Only a cash withdrawal can be itemized');
      expect(itemModel.create).not.toHaveBeenCalled();
    });

    it('refuses a missing or unknown category, and cash itself, writing nothing', async () => {
      await expect(service.add(W, { category: 'gone', amount: 10 })).rejects.toThrow(/unknown category/);
      await expect(service.add(W, { category: 'cash', amount: 10 })).rejects.toThrow(/left unitemized/);
      await expect(service.add(W, { amount: 10 })).rejects.toThrow(/category is required/);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([0, -5, NaN, Infinity, '5', 2e12, 0.004])('refuses the amount %p, writing nothing', async (amount) => {
      await expect(service.add(W, { category: 'food', amount })).rejects.toThrow(BadRequestException);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([42, 'x'.repeat(61)])('refuses the description %p, writing nothing', async (description) => {
      await expect(service.add(W, { category: 'food', amount: 10, description })).rejects.toThrow(BadRequestException);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('hands the reservation back when the item cannot be recorded', async () => {
      itemModel.create.mockRejectedValueOnce(new Error('write failed'));
      await expect(service.add(W, { category: 'food', amount: 300 })).rejects.toThrow('write failed');
      expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W }, { $inc: { allocatedCash: -300 } });
    });
  });

  describe('remove', () => {
    it('deletes the item, then gives its amount back to the withdrawal', async () => {
      itemModel.findOneAndDelete.mockReturnValueOnce(query({ _id: ITEM, withdrawalId: W, amount: 1500 }));
      await service.remove(ITEM);
      expect(itemModel.findOneAndDelete).toHaveBeenCalledWith({ _id: ITEM, userId: 1 });
      expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1 }, { $inc: { allocatedCash: -1500 } });
      expect(itemModel.findOneAndDelete.mock.invocationCallOrder[0]).toBeLessThan(txModel.updateOne.mock.invocationCallOrder[0]);
    });

    it('is a 404 for a missing item, and changes no counter', async () => {
      await expect(service.remove(ITEM)).rejects.toThrow(NotFoundException);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });
  });

  // Items carry category weight only: the withdrawal already moved the balance.
  it('never touches the balance: no ledger in CashModule or CashService', () => {
    expect(Reflect.getMetadata('imports', CashModule)).not.toContain(LedgerModule);
    expect(Reflect.getMetadata('design:paramtypes', CashService)).not.toContain(LedgerService);
  });
});
```

In `api/src/transactions/transactions.controller.spec.ts`:
- add `import { CashController } from '../cash/cash.controller';`;
- add the row `['CashController', CashController],` to the `describe.each` table.

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- cash.service transactions.controller 2>&1 | tail -10
```
Expected: FAIL. The modules `./cash.service` and `../cash/cash.controller` aren't found.

- [ ] **Step 3: Implement**

Create `api/src/cash/cash.service.ts`:
```ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { Category } from '../shared/schemas/category.enum';
import { NOT_DELETED, SPENDING_ONLY, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { CategoriesService } from '../categories/categories.service';
import { HALF_CENT, money, round2 } from './cash-rules';

export interface CashItemInput {
  category?: unknown;
  amount?: unknown;
  description?: unknown;
}

export interface CashBreakdown {
  id: string;
  name: string;
  timestamp: Date;
  /** The withdrawal's amount, positive. */
  amount: number;
  allocated: number;
  remaining: number;
  items: { id: string; category: string; description: string | null; amount: number }[];
}

const MAX_AMOUNT = 1e12;
const MAX_DESCRIPTION = 60;

/**
 * Itemizes ATM withdrawals. Items carry category weight only. They never touch
 * Balance or BalanceHistory, because the withdrawal already moved the balance,
 * which is why this service has no ledger.
 *
 * Over-itemizing is prevented by a reservation counter on the withdrawal
 * (Transaction.allocatedCash) that only guarded writes change. Every total
 * reads the items themselves.
 */
@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,
    private readonly categories: CategoriesService,
  ) {}

  /** A live withdrawal and its items, oldest first. What's allocated and left is computed from the items. */
  async breakdown(id: string): Promise<CashBreakdown> {
    const tx = await this.findLive(id);
    if (!this.itemizable(tx)) throw new NotFoundException('No such withdrawal');
    const items = await this.itemModel
      .find({ userId: this.userId, withdrawalId: String(tx._id) })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    const amount = Math.abs(tx.amount);
    const allocated = round2(items.reduce((s, i) => s + i.amount, 0));
    return {
      id: String(tx._id),
      name: tx.transactionName,
      timestamp: tx.timestamp,
      amount,
      allocated,
      remaining: round2(Math.max(0, amount - allocated)),
      items: items.map((i) => ({ id: String(i._id), category: i.category, description: i.description ?? null, amount: i.amount })),
    };
  }

  async add(withdrawalId: string, input: CashItemInput): Promise<{ id: string }> {
    const amount = this.parseAmount(input.amount);
    const description = this.parseDescription(input.description);
    const category = await this.parseCategory(input.category);
    if (!Types.ObjectId.isValid(withdrawalId)) throw new NotFoundException('No such withdrawal');

    // Reserve first, in one guarded write. The counter only grows while it stays
    // within the withdrawal, so two concurrent adds can't both fit into the same remainder.
    const reserved = await this.txModel.findOneAndUpdate(
      {
        _id: withdrawalId,
        userId: this.userId,
        isWithdrawal: true,
        amount: { $lt: 0 },
        ...SPENDING_ONLY,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ['$allocatedCash', 0] }, amount] },
            { $add: [{ $abs: '$amount' }, HALF_CENT] },
          ],
        },
      },
      { $inc: { allocatedCash: amount } },
      { new: true },
    );
    if (!reserved) throw await this.whyNotReserved(withdrawalId);

    try {
      const item = await this.itemModel.create({
        userId: this.userId,
        withdrawalId: String(reserved._id),
        category,
        amount,
        ...(description ? { description } : {}),
      });
      return { id: String(item._id) };
    } catch (err) {
      // No item was written, so hand the reservation back. If that fails too, the
      // counter stays high: that blocks some itemizing but never allows too much.
      try {
        await this.txModel.updateOne({ _id: reserved._id }, { $inc: { allocatedCash: -amount } });
      } catch (releaseErr) {
        this.logger.error(
          `Could not release ${amount} on withdrawal ${String(reserved._id)}`,
          releaseErr instanceof Error ? releaseErr.stack : String(releaseErr),
        );
      }
      throw err;
    }
  }

  async remove(itemId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException('No such item');
    // Delete first, then shrink the counter. A failure between the two leaves the
    // counter high (fail-safe), never low.
    const item = await this.itemModel.findOneAndDelete({ _id: itemId, userId: this.userId }).lean();
    if (!item) throw new NotFoundException('No such item');
    try {
      await this.txModel.updateOne({ _id: item.withdrawalId, userId: this.userId }, { $inc: { allocatedCash: -item.amount } });
    } catch (err) {
      this.logger.error(
        `Item ${itemId} was deleted but withdrawal ${item.withdrawalId} still counts its ${item.amount}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async findLive(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such withdrawal');
    const tx = await this.txModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx) throw new NotFoundException('No such withdrawal');
    return tx;
  }

  /** A spending withdrawal: the only kind of row that takes items. */
  private itemizable(tx: { isWithdrawal?: boolean; amount: number; transferKind?: string }): boolean {
    return !!tx.isWithdrawal && tx.amount < 0 && !isNonSpendingTransfer(tx.transferKind);
  }

  /** The reservation missed: find out why. This runs only on the failure path. */
  private async whyNotReserved(id: string): Promise<Error> {
    try {
      const tx = await this.findLive(id);
      if (!this.itemizable(tx)) return new BadRequestException('Only a cash withdrawal can be itemized');
      const left = round2(Math.max(0, Math.abs(tx.amount) - (tx.allocatedCash ?? 0)));
      return new BadRequestException(`Only ${money(left)} is left to itemize`);
    } catch (err) {
      return err as Error;
    }
  }

  private parseAmount(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new BadRequestException('amount must be a number');
    const amount = round2(raw);
    if (!(amount > 0)) throw new BadRequestException('amount must be greater than 0');
    if (amount > MAX_AMOUNT) throw new BadRequestException('amount is too large');
    return amount;
  }

  private parseDescription(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') throw new BadRequestException('description must be text');
    const text = raw.trim();
    if (text.length > MAX_DESCRIPTION) throw new BadRequestException(`description must be ${MAX_DESCRIPTION} characters or fewer`);
    return text || undefined;
  }

  private async parseCategory(raw: unknown): Promise<string> {
    if (typeof raw !== 'string' || !raw) throw new BadRequestException('category is required');
    if (raw === Category.CASH) throw new BadRequestException("Cash is what's left unitemized — pick where it went");
    await this.categories.assertValid(raw);
    return raw;
  }
}
```

Create `api/src/cash/cash.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CashItemInput, CashService } from './cash.service';

@Controller('cash')
@UseGuards(JwtAuthGuard)
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('withdrawals/:id')
  breakdown(@Param('id') id: string) {
    return this.cash.breakdown(id);
  }

  @Post('withdrawals/:id/allocations')
  @HttpCode(201)
  add(@Param('id') id: string, @Body() body: CashItemInput) {
    return this.cash.add(id, body ?? {});
  }

  @Delete('allocations/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.cash.remove(id);
  }
}
```

Replace `api/src/cash/cash.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';
import { CategoriesModule } from '../categories/categories.module';
import { CategorySpendService } from './category-spend.service';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';

// No LedgerModule, on purpose: items never move the balance (pinned in cash.service.spec.ts).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: CashAllocation.name, schema: CashAllocationSchema },
    ]),
    CategoriesModule,
  ],
  controllers: [CashController],
  providers: [CategorySpendService, CashService],
  exports: [CategorySpendService],
})
export class CashModule {}
```

`api/src/app.module.ts`: add `import { CashModule } from './cash/cash.module';`, and `CashModule,` right after `CategoriesModule,` in `imports`.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **46 suites / 472 tests** (24 in `cash.service.spec.ts` plus 1 guard pin), all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/cash/cash.service.ts api/src/cash/cash.service.spec.ts api/src/cash/cash.controller.ts api/src/cash/cash.module.ts api/src/app.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): itemize a withdrawal's cash, never beyond what was withdrawn

GET /cash/withdrawals/:id shows its items and what's left; POST adds one
behind a guarded reservation on the withdrawal; DELETE /cash/allocations/:id
removes one. Every multi-step write leaves the counter high rather than
low if interrupted, and nothing here touches the balance.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Transactions list and edits know about itemizing

**Files:**
- Modify: `api/src/transactions/transactions.service.ts` (`TransactionQuery`, `TransactionItem`, `buildFilter`, `findAll`, `update`)
- Modify: `api/src/transactions/transactions.controller.ts` (`findAll`)
- Test: `api/src/transactions/transactions.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `transactions.service.spec.ts`, add to `describe('findAll')`:
```ts
    it('selects isWithdrawal and allocatedCash so the page can offer itemizing', async () => {
      await service.findAll({});
      const fields = (mockModel.select.mock.calls[0][0] as string).split(' ');
      expect(fields).toEqual(expect.arrayContaining(['isWithdrawal', 'allocatedCash']));
    });

    it('can list only withdrawals with cash left to itemize', async () => {
      await service.findAll({ unitemized: true });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          isWithdrawal: true,
          amount: { $lt: 0 },
          $expr: { $gt: [{ $abs: '$amount' }, { $add: [{ $ifNull: ['$allocatedCash', 0] }, 0.005] }] },
        }),
      );
    });
```
Add to `describe('update')`:
```ts
    it("refuses to shrink a withdrawal below what's itemized", async () => {
      mockModel.findOne.mockResolvedValue(live({ isWithdrawal: true, allocatedCash: 4500, amount: -5000 }));
      await expect(service.update('t1', { amount: 4000 })).rejects.toThrow('$4,500.00 of this withdrawal is itemized — remove items first');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('guards a withdrawal amount edit against items added meanwhile', async () => {
      mockModel.findOne.mockResolvedValue(live({ isWithdrawal: true, allocatedCash: 4500, amount: -5000 }));
      await service.update('t1', { amount: 4600 });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -5000, $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, 4600 + 0.005] } }),
        { $set: { amount: -4600 } },
      );
    });

    it('adds no itemizing guard to an ordinary edit', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { amount: 130 });
      expect(mockModel.findOneAndUpdate.mock.calls[0][0]).not.toHaveProperty('$expr');
    });
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- transactions.service 2>&1 | grep -E "✕|Tests:"
```
Expected: the two `findAll` tests fail (the fields aren't selected and there's no filter), and so do the first two `update` tests (no refusal, no `$expr`). `adds no itemizing guard…` may already pass; it is a regression pin.

- [ ] **Step 3: Implement**

In `transactions.service.ts`:
- Add `import { HALF_CENT, money } from '../cash/cash-rules';`.
- In `TransactionQuery`, add `unitemized?: boolean;` after `needsReview?: boolean;`.
- In `TransactionItem`, add `isWithdrawal?: boolean;` and `allocatedCash?: number;`.
- In `buildFilter`, directly after `if (query.needsReview) filter.categoryNeedsReview = true;`, add:
```ts
    // Withdrawals with cash still to itemize (see CashService). The half cent
    // absorbs floating-point drift in the allocatedCash counter.
    if (query.unitemized) {
      filter.isWithdrawal = true;
      filter.amount = { $lt: 0 };
      filter.$expr = { $gt: [{ $abs: '$amount' }, { $add: [{ $ifNull: ['$allocatedCash', 0] }, HALF_CENT] }] };
    }
```
- In `findAll`, extend the `select` string with ` isWithdrawal allocatedCash`:
```ts
        .select('transactionName transactionType amount timestamp category categoryNeedsReview merchant source transferKind isWithdrawal allocatedCash')
```
- In `update`, inside `if (body.amount !== undefined) {`, directly after `patch.amount = newSigned;`, add:
```ts
      // A withdrawal can't shrink below what's already itemized (see CashService).
      if (tx.isWithdrawal && Math.abs(newSigned) + HALF_CENT < (tx.allocatedCash ?? 0)) {
        throw new BadRequestException(`${money(tx.allocatedCash ?? 0)} of this withdrawal is itemized — remove items first`);
      }
```
- In the guarded `findOneAndUpdate` filter of `update`, add a last entry after `transferKind: tx.transferKind ?? null,`:
```ts
        // A withdrawal whose amount changes must still cover what's itemized: an
        // item added since the read above would otherwise slip under the new amount.
        ...(tx.isWithdrawal && patch.amount !== undefined
          ? { $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, Math.abs(patch.amount as number) + HALF_CENT] } }
          : {}),
```

In `transactions.controller.ts` `findAll`, add the parameter `@Query('unitemized') unitemized?: string,` after `transferKind`, and the field `unitemized: unitemized === 'true',` after `transferKind,` in the object passed to the service.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **46 suites / 477 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/transactions/transactions.service.ts api/src/transactions/transactions.service.spec.ts api/src/transactions/transactions.controller.ts
git commit -F- <<'EOF'
feat(api): list what's itemized, filter unitemized cash, guard amount edits

The list carries isWithdrawal and allocatedCash; unitemized=true lists
withdrawals with cash left to itemize; a withdrawal's amount can't be
edited below what's itemized, even against a concurrent add.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Cash items in the Categories page's usage and moves

**Files:**
- Modify: `api/src/categories/category-references.service.ts`, `api/src/categories/categories.module.ts`, `api/src/categories/categories.service.ts`
- Modify: `web/src/app/core/services/api.models.ts` (`CategoryUsage`), `web/src/app/pages/categories/categories.component.ts`
- Test: `api/src/categories/category-references.service.spec.ts`, `api/src/categories/categories.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `category-references.service.spec.ts`:
- add `import { CashAllocation } from '../shared/schemas/cash-allocation.schema';`;
- add `let itemModel: { aggregate: jest.Mock; updateMany: jest.Mock };`, initialized in `beforeEach` as `itemModel = { aggregate: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) };`, with the provider `{ provide: getModelToken(CashAllocation.name), useValue: itemModel },`;
- rename the usage test to `'counts live transactions, active rules, budgets and cash items per category'`, add `itemModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 3 }]);` with the other mocks, and change its expectations to:
```ts
    expect(usage.get('gym')).toEqual({ transactions: 12, recurring: 1, budgets: 2, cashItems: 3 });
    expect(usage.get('food')).toEqual({ transactions: 4, recurring: 0, budgets: 0, cashItems: 0 });
```
  plus one more line at its end: `expect(itemModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1 } });`;
- add:
```ts
  it('moves cash items between the transactions and the recurring rules', async () => {
    await service.migrate('gym', 'health');
    expect(itemModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0];
    expect(order(txModel.updateMany)).toBeLessThan(order(itemModel.updateMany));
    expect(order(itemModel.updateMany)).toBeLessThan(order(recurringModel.updateMany));
  });
```

In `categories.service.spec.ts`:
- in every usage literal, append `cashItems: 0` after `budgets: N`. That covers every object with `transactions:`, `recurring:` and `budgets:` keys, in `refs.usage` mocks and in expected overview rows. Find them with `grep -n "budgets:" api/src/categories/categories.service.spec.ts`.
- add to `describe('remove')`:
```ts
    it('counts a category as in use through cash items alone', async () => {
      model.findOne.mockImplementation(findOneBy(gym()));
      refs.usage.mockResolvedValueOnce(new Map([['gym', { transactions: 0, recurring: 0, budgets: 0, cashItems: 2 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
    });
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- categor 2>&1 | grep -E "✕|Tests:"
```
Expected failures:
- the usage test (no `cashItems`);
- the migrate-order test (items not moved);
- every overview expectation (`cashItems` missing from `NO_USAGE`-derived rows);
- `in use through cash items alone` (only three fields are summed).

- [ ] **Step 3: Implement**

`category-references.service.ts`:
- Add `import { CashAllocation } from '../shared/schemas/cash-allocation.schema';`.
- Replace `Usage`, `NO_USAGE` and add `totalUses`:
```ts
export interface Usage {
  transactions: number;
  recurring: number;
  budgets: number;
  /** Itemized lines of ATM withdrawals (see api/src/cash). */
  cashItems: number;
}

export const NO_USAGE: Usage = { transactions: 0, recurring: 0, budgets: 0, cashItems: 0 };

/** Everything that names a category, however it names it. */
export const totalUses = (u: Usage): number => u.transactions + u.recurring + u.budgets + u.cashItems;
```
- Add the constructor parameter `@InjectModel(CashAllocation.name) private readonly itemModel: Model<CashAllocation>,` last.
- In `usage()`, update the docblock to `/** Live transactions, active recurring rules, budgets (any month) and cash items per category name. */`, make the `Promise.all` four-way:
```ts
    const [tx, rules, budgets, items] = await Promise.all([
      this.txModel.aggregate([{ $match: { userId: this.userId, ...NOT_DELETED } }, ...byCategory]),
      this.recurringModel.aggregate([{ $match: { userId: this.userId, active: true } }, ...byCategory]),
      this.budgetModel.aggregate([{ $match: { userId: this.userId } }, ...byCategory]),
      this.itemModel.aggregate([{ $match: { userId: this.userId } }, ...byCategory]),
    ]);
```
  and add `for (const r of items) entry(r._id).cashItems = r.n;` after the budgets loop.
- In `migrate`, directly after the transactions `updateMany`, add:
```ts
    await this.itemModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });
```

`categories.module.ts`: add `import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';`, and `{ name: CashAllocation.name, schema: CashAllocationSchema },` to `forFeature`. It registers the model itself so that it doesn't import `CashModule`, which imports it.

`categories.service.ts`:
- import `totalUses` alongside `NO_USAGE` from `./category-references.service`;
- in `remove()`, replace `const inUse = usage.transactions + usage.recurring + usage.budgets > 0;` with `const inUse = totalUses(usage) > 0;`.

Web, `web/src/app/core/services/api.models.ts`: add `cashItems: number;` to `CategoryUsage` after `budgets: number;`.

Web, `web/src/app/pages/categories/categories.component.ts`:
- `inUse`: `return c.usage.transactions + c.usage.recurring + c.usage.budgets + c.usage.cashItems > 0;`;
- `usageParts`: add `add(u.cashItems, 'cash item', 'cash items');` after the budgets line.

- [ ] **Step 4: Run the suite and both builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: **46 suites / 479 tests**, all passing; the api build is clean; the web build prints only `web-done`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/categories/category-references.service.ts api/src/categories/category-references.service.spec.ts api/src/categories/categories.module.ts api/src/categories/categories.service.ts api/src/categories/categories.service.spec.ts web/src/app/core/services/api.models.ts web/src/app/pages/categories/categories.component.ts
git commit -F- <<'EOF'
feat(api,web): cash items count as a category's usage and move with it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Ingestion books withdrawals as `cash`

**Files:**
- Modify: `api/src/ingestion/ingestion.service.ts` (the allowed list near line 149, and the category choice near line 169)
- Modify: `api/src/ingestion/categorizer.service.ts` (the `cajero` rule)
- Test: `api/src/ingestion/ingestion.service.spec.ts`, `api/src/ingestion/categorizer.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `ingestion.service.spec.ts`, directly after the test `'forces income to category "other" with categoryNeedsReview true and never consults the categorizer'`, add:
```ts
  it('books an ATM withdrawal as cash, without review and without asking the categorizer', async () => {
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ isWithdrawal: true, counterparty: 'Cajero Automatico' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.category).toBe('cash');
    expect(created.categoryNeedsReview).toBe(false);
    expect(created.isWithdrawal).toBe(true);
    expect(categorizer.categorize).not.toHaveBeenCalled();
  });

  it('never offers cash to the categorizer for a merchant', async () => {
    categories.list.mockResolvedValue([{ name: 'food' }, { name: 'cash' }, { name: 'other' }]);
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    expect(categorizer.categorize).toHaveBeenCalledWith('Test Merchant', ['food', 'other']);
  });
```
In `categorizer.service.spec.ts`, change the table row `['Cajero Automatico', 'other'],` to `['Cajero Automatico', 'cash'],`.

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ingestion 2>&1 | grep -E "✕|Tests:"
```
Expected: the two new ingestion tests fail, and so does the categorizer row for `Cajero Automatico`.

- [ ] **Step 3: Implement**

`ingestion.service.ts`:
- Add `import { Category } from '../shared/schemas/category.enum';` if it isn't imported yet.
- Where `allowed` is built, change it to:
```ts
      // cash is for ATM withdrawals only, which never reach the categorizer: never a guess for a merchant.
      allowed: (await this.categories.list()).map((c) => c.name).filter((name) => name !== Category.CASH),
```
- Replace the category choice with:
```ts
    const { category, needsReview } =
      p.direction === 'income'
        ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
        : p.isWithdrawal
          ? { category: Category.CASH, needsReview: false } // cash out of an ATM: itemized later on the web
          : await this.categorizer.categorize(p.counterparty, ctx.allowed);
```

`categorizer.service.ts`: change the last rule to `{ pattern: /\bcajero\s+autom\w*/i, category: 'cash' },`.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **46 suites / 481 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts api/src/ingestion/categorizer.service.ts api/src/ingestion/categorizer.service.spec.ts
git commit -F- <<'EOF'
feat(api): new ATM withdrawals land in cash, ready to itemize

They skip the categorizer (and its Mistral call); cash is never offered
as a guess for a merchant. Existing withdrawals are left where they are.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: The Transactions page: filter, row line and itemize panel

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.html`
- Modify: `web/src/app/pages/transactions/transactions.component.scss`

The web has no test runner. Verification is a clean build with zero warnings and no colour literals added to stylesheets.

- [ ] **Step 1: Models and api calls**

`api.models.ts`: add `isWithdrawal?: boolean;` and `allocatedCash?: number;` to `Transaction` after `transferKind?: string;`, and add after `TransactionPage`:
```ts
export interface CashItem {
  id: string;
  category: string;
  description: string | null;
  amount: number;
}

/** A withdrawal and what its cash went to. Amounts are positive. */
export interface CashBreakdown {
  id: string;
  name: string;
  timestamp: string;
  amount: number;
  allocated: number;
  remaining: number;
  items: CashItem[];
}

export interface CashItemInput {
  category: string;
  amount: number;
  description?: string;
}
```

`api.service.ts`:
- add `CashBreakdown` and `CashItemInput` to the import from `./api.models`;
- in `getTransactions`, add `unitemized?: boolean;` to `opts` and `if (opts.unitemized)  params = params.set('unitemized',  opts.unitemized);` after the `needsReview` line;
- add after `setTransactionCategory`:
```ts
  getCashBreakdown(withdrawalId: string): Observable<CashBreakdown> {
    return this.http.get<CashBreakdown>(`${this.base}/cash/withdrawals/${withdrawalId}`);
  }

  addCashItem(withdrawalId: string, body: CashItemInput): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/cash/withdrawals/${withdrawalId}/allocations`, body);
  }

  deleteCashItem(itemId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/cash/allocations/${itemId}`);
  }
```

- [ ] **Step 2: Component logic (`transactions.component.ts`)**

- Imports: add `import { HttpErrorResponse } from '@angular/common/http';`, and add `CashBreakdown` to the `api.models` import.
- Fields, after `needsReviewOnly = false;`:
```ts
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
```
- `currentFilters()`: add `unitemized:  this.unitemizedOnly || undefined,`.
- In `load()`'s `next`, after `this.error = null;`, and in `reloadInPlace()`'s `next`, after `this.error = null;`, add `this.dropPanelIfGone();`.
- Add after `onNeedsReviewToggle()`:
```ts
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
```
Do **not** call `this.events.notify()` after an item change (see the ground rules).

- [ ] **Step 3: Template (`transactions.component.html`)**

- After the Needs Review button, add:
```html
      <button class="review-toggle-btn"
              [class.active]="unitemizedOnly"
              [attr.aria-pressed]="unitemizedOnly"
              (click)="onUnitemizedToggle()">
        <mat-icon>local_atm</mat-icon>
        Unitemized cash
      </button>
```
- In the amount cell's non-transfer branch, replace the single `<span class="tx-amount" …>…</span>` with:
```html
              <span class="tx-amount-wrap">
                <span class="tx-amount" [class]="tx.isExpense ? 'expense' : 'income'">
                  {{ tx.isExpense ? '-' : '+' }}{{ tx.amount | currency:'USD':'symbol':'1.2-2' }}
                </span>
                @if (unitemized(tx) > 0) {
                  <span class="tx-unitemized">{{ unitemized(tx) | currency:'USD':'symbol':'1.2-2' }} not itemized</span>
                }
              </span>
```
- In the actions cell, first thing inside `<div class="tx-cell align-right tx-actions">`, add:
```html
            @if (tx.isWithdrawal && tx.isExpense) {
              <button [id]="'itemize-' + tx._id" type="button" class="act-btn"
                      [attr.aria-expanded]="cashFor === tx._id"
                      [attr.aria-controls]="cashFor === tx._id ? 'cash-' + tx._id : null"
                      (click)="toggleCash(tx)">
                Itemize
              </button>
            }
```
- Directly after the closing `</div>` of `<div class="tx-row">`, still inside the `@for`, add:
```html
        @if (cashFor === tx._id) {
          <section class="cash-panel" [id]="'cash-' + tx._id" [attr.aria-label]="'Itemize ' + tx.transactionName">
            @if (cash) {
              <p class="cash-remaining" aria-live="polite">
                Remaining {{ cash.remaining | currency:'USD':'symbol':'1.2-2' }} of {{ cash.amount | currency:'USD':'symbol':'1.2-2' }}
              </p>
              @if (cash.items.length) {
                <ul class="cash-items">
                  @for (item of cash.items; track item.id; let i = $index) {
                    <li class="cash-item">
                      <span class="cat-pill"
                            [style.background]="catColor(item.category) + '22'"
                            [style.color]="catColor(item.category)">
                        <span class="dot" [style.background]="catColor(item.category)"></span>
                        {{ item.category | titlecase }}
                      </span>
                      <span class="cash-item-desc">{{ item.description }}</span>
                      <span class="cash-item-amount">{{ item.amount | currency:'USD':'symbol':'1.2-2' }}</span>
                      <button [id]="'remove-' + item.id" type="button" class="icon-act" [disabled]="cashBusy"
                              [attr.aria-label]="'Remove ' + item.category + ' ' + (item.amount | currency:'USD':'symbol':'1.2-2')"
                              (click)="removeItem(tx, i)">
                        <mat-icon>close</mat-icon>
                      </button>
                    </li>
                  }
                </ul>
              }
              @if (cash.remaining > 0) {
                <form class="cash-form" (ngSubmit)="addItem(tx)">
                  <label class="fc-field">
                    <span>Category</span>
                    <select id="cash-category" class="fc-input" [(ngModel)]="itemCategory" name="itemCategory">
                      <option value="" disabled>Where did it go?</option>
                      @for (cat of itemCategories; track cat) {
                        <option [value]="cat">{{ cat | titlecase }}</option>
                      }
                    </select>
                  </label>
                  <label class="fc-field">
                    <span>Amount</span>
                    <input class="fc-input" type="number" step="0.01" min="0.01" [max]="cash.remaining"
                           [(ngModel)]="itemAmount" name="itemAmount" />
                  </label>
                  <label class="fc-field cash-desc-field">
                    <span>Description</span>
                    <input class="fc-input" type="text" maxlength="60" placeholder="What was it? (optional)"
                           [(ngModel)]="itemDescription" name="itemDescription" />
                  </label>
                  <button type="submit" class="fc-btn fc-btn--primary" [disabled]="!canAddItem">
                    {{ cashBusy ? 'Adding…' : 'Add' }}
                  </button>
                </form>
              } @else {
                <p class="cash-muted">All of it is itemized.</p>
              }
            } @else if (cashLoading) {
              <p class="cash-muted">Loading…</p>
            }
            @if (cashError) {
              <p class="fc-error" role="alert">{{ cashError }}</p>
            }
          </section>
        }
```

- [ ] **Step 4: Styles (`transactions.component.scss`)**

Append (theme tokens only, no colour literals):
```scss
// ── Itemize a withdrawal ───────────────────────────────────────────────
.tx-amount-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.tx-unitemized {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.cash-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm) 24px var(--space-md);
  border-bottom: 1px solid var(--border);
  background: var(--bg-card-alt);
}

.cash-remaining {
  margin: 0;
  font-weight: 600;
  color: var(--text);
}

.cash-muted {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.cash-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}

.cash-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.cash-item-desc {
  flex: 1 1 8rem;
  min-width: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.cash-item-amount { font-variant-numeric: tabular-nums; }

.cash-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-xs);

  .fc-field { flex: 1 1 10rem; min-width: 0; }
  .cash-desc-field { flex-basis: 14rem; }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 5: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff -- web | grep -nE "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()" | grep -v "category.service.ts"; echo literal-done
```
Expected: `web-done` alone (no warnings or errors) and `literal-done` alone. The only hex in the web diff is `cash`'s data colour in `category.service.ts`, which comes from Task 1 and is committed already, so it doesn't appear here.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/core/services/api.models.ts web/src/app/core/services/api.service.ts web/src/app/pages/transactions/transactions.component.ts web/src/app/pages/transactions/transactions.component.html web/src/app/pages/transactions/transactions.component.scss
git commit -F- <<'EOF'
feat(web): itemize a withdrawal's cash on the Transactions page

An Itemize panel on withdrawal rows lists what the cash went to, what's
left, and adds or removes items; rows show how much isn't itemized; an
"Unitemized cash" filter finds the ones left to do.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

- After the **Categories** feature row (line ~46), add:
```markdown
| **Cash envelopes** | Itemize an ATM withdrawal into what the cash was spent on; items count toward their categories' budgets and statistics without adding to total spending |
```
- In the API table, change the `/api/transactions` row's description to `Paginated transaction list (filters: \`type\`, \`category\`, \`startDate\`, \`endDate\`, \`needsReview\`, \`unitemized\`)`, and after the categories rows add:
```markdown
| `GET` | `/api/cash/withdrawals/:id` | A withdrawal's items, what's itemized and what's left |
| `POST` | `/api/cash/withdrawals/:id/allocations` | Itemize `{ category, amount, description? }` (never beyond the withdrawal) |
| `DELETE` | `/api/cash/allocations/:id` | Remove an item |
```
- In the project tree (line ~68), add `│   │   ├── cash/           ← itemized withdrawals, per-category spending` directly after the `categories/` line if there is one, else after `transactions/`, matching the neighbours' indentation.

- [ ] **Step 2: Suites and builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: api **46 suites / 481 tests**, build clean; web `web-done` alone.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add README.md
git commit -F- <<'EOF'
docs(readme): cash envelopes and their endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format=%B -11 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```
Expected: `11`, and a clean tree. The controller runs the private-identifier check separately.

---

## After the tasks (controller)

1. Spec review, then code-quality review, then fixes. Then a preview-harness screenshot of the Transactions page with an open panel (desktop and phone), the private-identifier gate, and the push.
2. Hand the user: restart `accounting-api` and `accounting-web` once CI is green. Then, on **Transactions**, pick a withdrawal (new ones land in `cash`), **Itemize** it into two categories, and watch Budget and Statistics count them.
