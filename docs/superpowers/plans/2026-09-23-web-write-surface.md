# Web Write Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app can create, edit, soft-delete and resolve transactions and create recurring rules, so the retiring Telegram bot is no longer needed for daily use.

**Architecture:** One `LedgerService` in `api/` becomes the single place the balance and its history move, used by ingestion and by the new endpoints. Two shared filter constants per package (`NOT_DELETED`, `SPENDING_ONLY`) replace the 21 hand-copied `$nin` literals and carry the new `deletedAt` rule. On the web, a global floating `+` opens one overlay form used for both create and edit; a tiny events service tells the dashboard and list to reload.

**Tech Stack:** NestJS 10 + Mongoose (`api/`, **pnpm**; `repo/`, **npm**), Angular 17 standalone components + Angular Material icons (`web/`, **pnpm**), Jest.

**Spec:** `docs/superpowers/specs/2026-09-23-web-write-surface-design.md`

---

## Critical context for the implementer

1. **`TransactionType` values are legacy Russian strings** (`api/src/shared/schemas/transaction-type.enum.ts`: `INCOME = 'Доход'`, `EXPENSE = 'Расход'`). Always the enum, never a literal.
2. **Expenses are stored negative, income positive.** The stored sign is the source of truth for direction.
3. **`internal` and `unresolved` rows never moved the balance.** Editing or deleting them must not move it either. `isNonSpendingTransfer()` is the only way to ask.
4. **Never hard-delete.** An email-sourced row's `sourceMessageId` must stay in the collection or the next poll re-creates the row and re-applies the balance.
5. **Both schemas back one collection.** `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts` must both get `deletedAt`.
6. **Fixtures are synthetic.** Account holder `JUAN ANTONIO RIVERA MARTE`; never anything resembling a real account, name or email. The repo is public.
7. **Design tokens live in `web/src/tokens.css`.** Every colour and font in new styles must be `var(--…)` from that file. No hex, no inline `oklch()`. If a value is missing, add a token there first.
8. **The api's existing test harness** (`transactions.service.spec.ts`) uses Nest `Test.createTestingModule` + `getModelToken`; `ingestion.service.spec.ts` the same plus `jest.mock` of a parser. `repo/` specs construct services directly with `new Service(mockModel as any, …)`. Match the neighbouring file.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `api/src/shared/schemas/transfer-kind.ts` | `NON_SPENDING_KINDS`, `isNonSpendingTransfer`, `NOT_DELETED`, `SPENDING_ONLY` |
| `repo/src/type/transfer-kind.ts` | The same four, for the bot |
| `api/src/shared/ledger/ledger.service.ts` + `ledger.module.ts` + `ledger.service.spec.ts` | The only code that moves `Balance` and writes `BalanceHistory` |
| `web/src/app/core/services/transaction-events.service.ts` | `changed$` — "a transaction was written, reload" |
| `web/src/app/core/services/transaction-form.service.ts` | `openCreate()` / `openEdit(tx)` requests for the global form |
| `web/src/app/core/ui/fab/fab.component.{ts,html,scss}` | Floating `+`, eight states |
| `web/src/app/core/ui/transaction-form/transaction-form.component.{ts,html,scss}` | Overlay create/edit form |

**Modify**

| File | Change |
|---|---|
| both transaction schemas | `deletedAt?: Date` |
| `api/src/ingestion/ingestion.service.ts` + spec | use `LedgerService`; drop private `applyBalance` |
| 14 aggregation/listing files (listed in Task 3) | spread the shared constants |
| `api/src/categories/categories.module.ts` | export `CategoriesService` |
| `api/src/transactions/transactions.{module,controller,service}.ts` + spec | create / update / soft-delete / resolve |
| `api/src/recurring/recurring.{module,controller,service}.ts` | create |
| `repo/src/service/transaction.service.ts` + spec | soft-delete; balance guards on delete/edit |
| `api/src/ingestion/categorizer.service.ts` + spec | canonical-name match; word-boundary rules |
| `web/src/app/core/services/api.service.ts`, `api.models.ts` | new calls and request types |
| `web/src/app/app.component.{ts,html}` | mount FAB + form |
| `web/src/app/pages/transactions/transactions.component.{ts,html,scss}` | row actions; reload on events; drop duplicate getter |
| `web/src/app/pages/recurring/recurring.component.{ts,html,scss}` | create form |
| `web/src/app/pages/dashboard/dashboard.component.{ts,html}` | tag transfers; reload on events |
| `web/src/tokens.css` | `--overlay-scrim` |

---

## Phase 1 — Shared foundations (api + repo)

### Task 1: Transfer-kind constants in both packages

**Files:**
- Create: `api/src/shared/schemas/transfer-kind.ts`, `api/src/shared/schemas/transfer-kind.spec.ts`
- Create: `repo/src/type/transfer-kind.ts`, `repo/src/type/transfer-kind.spec.ts`

- [ ] **Step 1: Write the failing test (api)**

`api/src/shared/schemas/transfer-kind.spec.ts`:

```typescript
import { isNonSpendingTransfer, NOT_DELETED, SPENDING_ONLY, NON_SPENDING_KINDS } from './transfer-kind';

describe('transfer-kind constants', () => {
  it('treats internal and unresolved as non-spending', () => {
    expect(isNonSpendingTransfer('internal')).toBe(true);
    expect(isNonSpendingTransfer('unresolved')).toBe(true);
  });

  // Ordinary card transactions have no transferKind at all and MUST count.
  it('treats external and absent as spending', () => {
    expect(isNonSpendingTransfer('external')).toBe(false);
    expect(isNonSpendingTransfer(undefined)).toBe(false);
    expect(isNonSpendingTransfer(null)).toBe(false);
    expect(isNonSpendingTransfer('')).toBe(false);
  });

  it('NOT_DELETED matches only live rows', () => {
    expect(NOT_DELETED).toEqual({ deletedAt: null });
  });

  it('SPENDING_ONLY excludes deleted rows and non-spending kinds', () => {
    expect(SPENDING_ONLY).toEqual({
      deletedAt: null,
      transferKind: { $nin: [...NON_SPENDING_KINDS] },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && pnpm test transfer-kind`
Expected: FAIL — `Cannot find module './transfer-kind'`

- [ ] **Step 3: Create the api module**

`api/src/shared/schemas/transfer-kind.ts`:

```typescript
/**
 * How a transaction relates to the user's own accounts.
 *   external   — money left to / arrived from a third party; spending or income
 *   internal   — moved between the user's own cash accounts; never spending
 *   unresolved — could not be determined; recorded, never asserted
 * Absent means an ordinary card transaction, which always counts.
 */
export type TransferKind = 'external' | 'internal' | 'unresolved';

export const NON_SPENDING_KINDS = ['internal', 'unresolved'] as const;

export function isNonSpendingTransfer(kind?: string | null): boolean {
  return !!kind && (NON_SPENDING_KINDS as readonly string[]).includes(kind);
}

/**
 * Spread into EVERY query on the transactions collection. In Mongo,
 * `deletedAt: null` matches documents where the field is null OR absent, so
 * every row written before soft-delete existed still qualifies.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/**
 * Spread into every query that sums, averages, counts or groups money.
 * `$nin` matches an absent field, so ordinary card transactions keep counting.
 */
export const SPENDING_ONLY = {
  ...NOT_DELETED,
  transferKind: { $nin: [...NON_SPENDING_KINDS] },
} as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && pnpm test transfer-kind` — Expected: PASS, 4 tests

- [ ] **Step 5: Mirror into repo**

Create `repo/src/type/transfer-kind.ts` with **identical** content, and `repo/src/type/transfer-kind.spec.ts` with the identical test (import path `./transfer-kind`).

Run: `cd repo && npm test -- transfer-kind` — Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add api/src/shared/schemas/transfer-kind.ts api/src/shared/schemas/transfer-kind.spec.ts repo/src/type/transfer-kind.ts repo/src/type/transfer-kind.spec.ts
git commit -m "feat: shared transfer-kind and deleted-row filter constants in both services"
```

---

### Task 2: `deletedAt` on both schemas

**Files:**
- Modify: `api/src/shared/schemas/transaction.schema.ts`
- Modify: `repo/src/mongodb/schemas/transaction.schemas.ts`

- [ ] **Step 1: Add to api**, after `matchedLegId`:

```typescript
  /** Soft-delete marker. Rows are never removed: an email-sourced row must keep its sourceMessageId. */
  @Prop() deletedAt?: Date;
```

- [ ] **Step 2: Add to repo**, after `matchedLegId`, in that file's multi-line style:

```typescript
  @Prop()
  deletedAt?: Date;
```

- [ ] **Step 3: Verify both build**

Run: `cd api && pnpm run build` and `cd repo && npm run build` — both clean.

- [ ] **Step 4: Commit**

```bash
git add api/src/shared/schemas/transaction.schema.ts repo/src/mongodb/schemas/transaction.schemas.ts
git commit -m "feat(schemas): add deletedAt soft-delete marker to both services"
```

---

### Task 3: Replace every hand-copied filter with the constants

**Files (api):** `analytics/analytics.service.ts`, `budget/budget.service.ts`, `compare/compare.service.ts`, `statistics/statistics.service.ts`, `tips/tips.service.ts`, `transactions/transactions.service.ts`, and their specs.
**Files (repo):** `service/advanced.statistics.service.ts`, `service/budget.service.ts`, `service/cron.notifications.service.ts`, `service/export.service.ts`, `service/statistics.service.ts`, `service/transaction.service.ts` (listing methods), `handler/compare.handler.ts`, and their specs.

- [ ] **Step 1: Find every site — do not work from this list alone**

```bash
cd "<root>" && git grep -n "transferKind: { \$nin" -- api/src repo/src
```
and
```bash
cd "<root>" && git grep -nE "transactionModel\.(find|findOne|aggregate|countDocuments)\(|\.find\(\{ *userId" -- api/src repo/src | grep -v spec
```

The second grep is the real list. For each hit decide: **sums/averages/counts/groups money** → `...SPENDING_ONLY`; **lists rows for display or lookup** → `...NOT_DELETED`. Point lookups by `_id` for a write path are handled in their own tasks below and use `NOT_DELETED` there.

- [ ] **Step 2: Write the failing tests first**

For each spec that currently asserts the `$nin` literal, change the assertion to the constant so it also demands `deletedAt: null`:

```typescript
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';   // api
// import { SPENDING_ONLY } from '../type/transfer-kind';           // repo

expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
```

For aggregate pipelines, assert the `$match` stage: `expect(pipeline[0].$match).toEqual(expect.objectContaining(SPENDING_ONLY))`.

For listing queries that had no assertion, add one asserting `expect.objectContaining(NOT_DELETED)`. Every changed assertion must **fail** before Step 3 (the literal has no `deletedAt`).

- [ ] **Step 3: Replace the literals**

In each `find(...)` filter object or `$match` stage, replace the literal `transferKind: { $nin: ['internal', 'unresolved'] }` (and any local `transferGuard` const) with `...SPENDING_ONLY`, importing the constant. Add `...NOT_DELETED` to every listing query found in Step 1. In `repo/src/service/transaction.service.ts`, `showLastNTransactionsWithDeleteOption`, `showLastNTransactionsWithEditOption`, `searchTransactions` and `getTransactionById` are listings → `...NOT_DELETED`. In `repo/src/handler/compare.handler.ts` the last-30 fetch feeds the AI prompt → `...SPENDING_ONLY`.

Delete every now-unused local `transferGuard` declaration.

- [ ] **Step 4: Verify**

Run: `cd api && pnpm test` and `cd repo && npm test` — all green.
Run: `git grep -n "\$nin: \['internal'" -- api/src repo/src` — Expected: **no hits outside `transfer-kind.ts`**.

- [ ] **Step 5: Commit**

```bash
git add -A api/src repo/src
git commit -m "refactor: use shared NOT_DELETED / SPENDING_ONLY filters at every transaction query"
```

---

### Task 4: `LedgerService` — one place the balance moves

**Files:**
- Create: `api/src/shared/ledger/ledger.service.ts`, `ledger.module.ts`, `ledger.service.spec.ts`
- Modify: `api/src/ingestion/ingestion.service.ts`, `ingestion.module.ts`, `ingestion.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`api/src/shared/ledger/ledger.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LedgerService } from './ledger.service';
import { Balance } from '../schemas/balance.schema';
import { BalanceHistory } from '../schemas/balance-history.schema';

describe('LedgerService', () => {
  let service: LedgerService;
  let balanceDoc: any;
  let balanceModel: any;
  let historyModel: any;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceDoc = { userId: 1, balance: 1000, lastActivity: null, save: jest.fn().mockResolvedValue(undefined) };
    balanceModel = { findOne: jest.fn().mockResolvedValue(balanceDoc), create: jest.fn() };
    historyModel = { create: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: getModelToken(BalanceHistory.name), useValue: historyModel },
      ],
    }).compile();
    service = mod.get(LedgerService);
  });

  it('applies a signed delta and records history', async () => {
    const r = await service.apply(-250, 'expense', 'uber', 'tx1');
    expect(balanceDoc.balance).toBe(750);
    expect(balanceDoc.save).toHaveBeenCalled();
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
  });

  it('reverse undoes a stored amount regardless of sign', async () => {
    await service.reverse(-300, 'x', 'tx2');   // stored expense
    expect(balanceDoc.balance).toBe(1300);
    await service.reverse(500, 'y', 'tx3');    // stored income
    expect(balanceDoc.balance).toBe(800);
    expect(historyModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'delete', delta: -500 }));
  });

  it('creates the balance document when none exists', async () => {
    balanceModel.findOne.mockResolvedValue(null);
    const created = { userId: 1, balance: 0, save: jest.fn().mockResolvedValue(undefined) };
    balanceModel.create.mockResolvedValue(created);
    await service.apply(100, 'income');
    expect(balanceModel.create).toHaveBeenCalledWith({ userId: 1, balance: 0 });
    expect(created.balance).toBe(100);
  });

  // Mirrors the bot and ingestion: a history write failure must never undo
  // or block the balance movement that already happened.
  it('swallows a history failure after the balance moved', async () => {
    historyModel.create.mockRejectedValue(new Error('down'));
    await expect(service.apply(-10, 'expense')).resolves.toEqual({ previousBalance: 1000, newBalance: 990 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd api && pnpm test ledger` → `Cannot find module './ledger.service'`

- [ ] **Step 3: Create the service and module**

`api/src/shared/ledger/ledger.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../schemas/balance.schema';
import { BalanceChangeReason, BalanceHistory } from '../schemas/balance-history.schema';

/**
 * The only code in api/ that moves the user's balance. Every write path —
 * ingestion, manual create, edit, delete, resolution — goes through here so
 * the balance and its history can never disagree about what happened.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private readonly historyModel: Model<BalanceHistory>,
  ) {}

  /** Adds a SIGNED delta (expense negative, income positive) and records history. */
  async apply(
    delta: number,
    reason: BalanceChangeReason,
    transactionName?: string,
    transactionId?: string,
  ): Promise<{ previousBalance: number; newBalance: number }> {
    const balance =
      (await this.balanceModel.findOne({ userId: this.userId })) ??
      (await this.balanceModel.create({ userId: this.userId, balance: 0 }));

    const previousBalance = balance.balance;
    balance.balance += delta;
    balance.lastActivity = new Date();
    await balance.save();

    // History failure must never break the movement that already happened.
    try {
      await this.historyModel.create({
        userId: this.userId,
        previousBalance,
        newBalance: balance.balance,
        delta,
        reason,
        transactionName,
        transactionId,
      });
    } catch (err) {
      this.logger.error('Failed to record balance history', String(err));
    }
    return { previousBalance, newBalance: balance.balance };
  }

  /**
   * Undo a stored amount. Works for both signs: a stored expense of -300
   * reverses as +300, a stored income of +500 reverses as -500.
   */
  reverse(storedAmount: number, transactionName?: string, transactionId?: string) {
    return this.apply(-storedAmount, 'delete', transactionName, transactionId);
  }
}
```

`api/src/shared/ledger/ledger.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../schemas/balance.schema';
import { BalanceHistory, BalanceHistorySchema } from '../schemas/balance-history.schema';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Balance.name, schema: BalanceSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
    ]),
  ],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
```

Check the exact exported schema names in `balance.schema.ts` (`BalanceSchema`) and adjust the import if it differs.

- [ ] **Step 4: Run to verify it passes** — `pnpm test ledger` → PASS, 4 tests

- [ ] **Step 5: Switch ingestion to the ledger**

In `ingestion.module.ts` import `LedgerModule` and remove `Balance`/`BalanceHistory` from its `forFeature` list if nothing else there uses them. In `ingestion.service.ts`: inject `private readonly ledger: LedgerService` instead of the two models; delete the private `applyBalance`; at its former call site, replace with:

```typescript
      await this.ledger.apply(signed, p.direction, p.counterparty, String(doc._id));
```

(`signed` is already the signed amount; `p.direction` is `'income' | 'expense'`, which are valid `BalanceChangeReason`s.)

In `ingestion.service.spec.ts`: replace the `Balance`/`BalanceHistory` model providers with `{ provide: LedgerService, useValue: { apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }), reverse: jest.fn() } }`. Map the existing assertions one-for-one — **the meaning of every test must survive**:

| was | becomes |
|---|---|
| `expect(balanceDoc.save).not.toHaveBeenCalled()` | `expect(ledger.apply).not.toHaveBeenCalled()` |
| `expect(balanceDoc.save).toHaveBeenCalled()` | `expect(ledger.apply).toHaveBeenCalledWith(-1150, 'expense', expect.any(String), expect.any(String))` (use the test's own amount/direction) |
| `expect(historyModel.create).not.toHaveBeenCalled()` | drop — history is the ledger's concern, now tested in `ledger.service.spec.ts` |
| the balance-direction test (850 vs 1150) | assert the signed delta passed to `apply`: `-150` for the expense, `+150` for the income |
| the A7 rollback test (`applyBalance` rejects → `deleteOne`) | `ledger.apply.mockRejectedValueOnce(new Error('x'))` → `deleteOne` still called, result `'failed'` |

- [ ] **Step 6: Run the whole api suite** — `pnpm test` → all green, same count as before plus the 4 ledger tests. `pnpm run build` clean.

- [ ] **Step 7: Commit**

```bash
git add api/src/shared/ledger api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.module.ts api/src/ingestion/ingestion.service.spec.ts
git commit -m "refactor(api): move balance and history writes into a single LedgerService"
```

---

### Task 4b: Make `LedgerService.apply` atomic

Phase 1 review: `apply` is a `findOne` → `+=` → `save` read-modify-write, identical to the bot's. That was tolerable while the ingestion poll was the only writer. Phase 2 puts the web beside it, so two writers can both read 1000, one save 850 and the other 1100 — a lost update on the user's balance. Now that the ledger is the one place the balance moves, make the movement a single `$inc`.

**Files:** `api/src/shared/ledger/ledger.service.ts`, `ledger.service.spec.ts`

- [ ] **Step 1: Rewrite the spec's arrange block and the two affected tests**

Replace the `balanceDoc`/`balanceModel` setup with:

```typescript
    balanceModel = { findOneAndUpdate: jest.fn().mockResolvedValue({ userId: 1, balance: 750 }) };
```

and the first test with:

```typescript
  it('applies a signed delta with one atomic $inc and records history from the returned balance', async () => {
    const r = await service.apply(-250, 'expense', 'uber', 'tx1');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 },
      { $inc: { balance: -250 }, $set: { lastActivity: expect.any(Date) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
  });
```

Replace `creates the balance document when none exists` with:

```typescript
  // upsert: a first-ever movement creates the document at 0 + delta.
  it('upserts the balance document when none exists', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValue({ userId: 1, balance: 100 });
    const r = await service.apply(100, 'income');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 }, expect.objectContaining({ $inc: { balance: 100 } }), expect.objectContaining({ upsert: true }),
    );
    expect(r).toEqual({ previousBalance: 0, newBalance: 100 });
  });
```

For `reverse`, have `findOneAndUpdate` resolve `{ balance: 1300 }` then `{ balance: 800 }` via `mockResolvedValueOnce` and keep the existing assertions on the recorded `delta`. The history-failure test is unchanged.

- [ ] **Step 2: Run** — `cd api && pnpm test ledger` → the first two must FAIL (`findOne` is not a function / wrong call shape).

- [ ] **Step 3: Implement**

```typescript
  async apply(
    delta: number,
    reason: BalanceChangeReason,
    transactionName?: string,
    transactionId?: string,
  ): Promise<{ previousBalance: number; newBalance: number }> {
    // A single atomic $inc: concurrent writers (the ingestion poll and the web)
    // can never lose each other's update the way a read-modify-write can.
    const updated = await this.balanceModel.findOneAndUpdate(
      { userId: this.userId },
      { $inc: { balance: delta }, $set: { lastActivity: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const newBalance = updated.balance;
    const previousBalance = newBalance - delta;

    // History failure must never break the movement that already happened.
    try {
      await this.historyModel.create({
        userId: this.userId, previousBalance, newBalance, delta, reason, transactionName, transactionId,
      });
    } catch (err) {
      this.logger.error('Failed to record balance history', String(err));
    }
    return { previousBalance, newBalance };
  }
```

`reverse` is unchanged in behaviour; give it an explicit return type `Promise<{ previousBalance: number; newBalance: number }>` (code-quality review), and reword the class doc so it states an obligation rather than a present fact — "Every write path … **must** go through here".

- [ ] **Step 4: Run** — `pnpm test ledger` PASS; `pnpm test` all green (the ingestion spec mocks the whole ledger, so it is unaffected); `pnpm run build` clean.
- [ ] **Step 5: Commit** — `git commit -m "fix(api): make the ledger's balance movement a single atomic \$inc"`

---

### Task 4c: Use the helper for the three remaining predicate re-spellings

The spec says the JS re-spellings of "is this non-spending" use `isNonSpendingTransfer`. Three remain:

- `api/src/ingestion/ingestion.service.ts` (~line 314, the post-create balance gate)
- `api/src/ingestion/reconciliation.service.ts` (~line 49, the `matchedPeriod` guard)
- `api/src/transactions/transactions.service.ts` (~line 123, the CSV `type` column)

- [ ] **Step 1:** replace each `x === 'internal' || x === 'unresolved'` with `isNonSpendingTransfer(x)`, importing from `../shared/schemas/transfer-kind` (adjust relative path per file). Leave the single `=== 'internal'` at ingestion ~line 187 alone — that is a different predicate.
- [ ] **Step 1b (code-quality review):** `api/src/ingestion/parsers/types.ts` and the two transfer parsers declare their own `'external' | 'internal' | 'unresolved'` literal — import `TransferKind` from `transfer-kind.ts` instead. In `transactions.service.ts` `buildFilter`, replace `filter.transferKind = SPENDING_ONLY.transferKind` with `{ $nin: [...NON_SPENDING_KINDS] }` so the site does not reach into another constant's shape, and split the run-on comment above it into two. Broaden the `deletedAt` comment in **both** transaction schemas: soft-delete applies to every row; the `sourceMessageId` case is *why* it must be soft.
- [ ] **Step 2:** `pnpm test` all green — the existing suites cover all three sites. `pnpm run build` clean; `cd repo && npm run build` clean.
- [ ] **Step 3: Commit** — `git commit -m "refactor(api): use isNonSpendingTransfer at the three remaining predicate sites"`

---

## Phase 2 — API write endpoints

### Task 5: Module wiring and the category allow-list

**Files:**
- Modify: `api/src/categories/categories.module.ts`, `api/src/transactions/transactions.module.ts`, `api/src/recurring/recurring.module.ts`

- [ ] **Step 1: Export `CategoriesService`**

In `categories.module.ts` add `exports: [CategoriesService],` to the `@Module` metadata.

- [ ] **Step 2: Wire transactions and recurring**

`transactions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
    LedgerModule,
    CategoriesModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```

In `recurring.module.ts` add `CategoriesModule` to `imports`.

- [ ] **Step 3: Build** — `cd api && pnpm run build` clean (there is a circular-import risk only if CategoriesModule imports TransactionsModule; it does not).

- [ ] **Step 4: Commit**

```bash
git add api/src/categories/categories.module.ts api/src/transactions/transactions.module.ts api/src/recurring/recurring.module.ts
git commit -m "chore(api): wire LedgerModule and CategoriesModule into transactions and recurring"
```

---

### Task 6: `POST /transactions`

**Files:**
- Modify: `api/src/transactions/transactions.service.ts`, `transactions.controller.ts`, `transactions.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `transactions.service.spec.ts`. Extend the module setup with two more providers: `{ provide: LedgerService, useValue: ledger }` where `ledger = { apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }), reverse: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }) }`, and `{ provide: CategoriesService, useValue: { list: jest.fn().mockResolvedValue([{ name: 'food' }, { name: 'other' }, { name: 'Gym' }]) } }`. Give `mockModel` a `create: jest.fn()`.

```typescript
import { TransactionType } from '../shared/schemas/transaction-type.enum';

describe('create', () => {
  beforeEach(() => mockModel.create.mockResolvedValue({ _id: 'new1' }));

  it('stores an expense negative, via the enum, as source manual, and moves the balance', async () => {
    await service.create({ type: 'expense', amount: 150, name: 'Colmado', category: 'food' });
    expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: TransactionType.EXPENSE,
      amount: -150,
      transactionName: 'colmado',
      category: 'food',
      source: 'manual',
    }));
    expect(ledger.apply).toHaveBeenCalledWith(-150, 'expense', 'Colmado', 'new1');
  });

  it('stores income positive', async () => {
    await service.create({ type: 'income', amount: 2000, name: 'Freelance', category: 'other' });
    expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({ transactionType: TransactionType.INCOME, amount: 2000 }));
    expect(ledger.apply).toHaveBeenCalledWith(2000, 'income', 'Freelance', 'new1');
  });

  it('rejects a non-positive amount', async () => {
    await expect(service.create({ type: 'expense', amount: 0, name: 'x', category: 'food' })).rejects.toThrow(/amount/);
    expect(mockModel.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown category', async () => {
    await expect(service.create({ type: 'expense', amount: 1, name: 'x', category: 'nope' })).rejects.toThrow(/category/);
  });

  it('rejects a blank name and a bad type', async () => {
    await expect(service.create({ type: 'expense', amount: 1, name: '  ', category: 'food' })).rejects.toThrow(/name/);
    await expect(service.create({ type: 'refund' as any, amount: 1, name: 'x', category: 'food' })).rejects.toThrow(/type/);
  });

  it('uses the provided timestamp, else now', async () => {
    await service.create({ type: 'expense', amount: 1, name: 'x', category: 'food', timestamp: '2026-09-01T12:00:00Z' });
    expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({ timestamp: new Date('2026-09-01T12:00:00Z') }));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test transactions.service` → `service.create is not a function`

- [ ] **Step 3: Implement**

In `transactions.service.ts` add imports and the request types:

```typescript
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { isNonSpendingTransfer, NOT_DELETED, SPENDING_ONLY } from '../shared/schemas/transfer-kind';

export interface CreateTransactionBody {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  timestamp?: string;
}
```

Inject in the constructor: `private readonly ledger: LedgerService, private readonly categories: CategoriesService`.

Add the helpers and the method:

```typescript
  private async assertCategory(category: string): Promise<void> {
    const allowed = (await this.categories.list()).map((c) => c.name);
    if (!allowed.includes(category)) throw new BadRequestException(`unknown category: ${category}`);
  }

  private assertPositive(amount: number): void {
    if (typeof amount !== 'number' || !(amount > 0)) throw new BadRequestException('amount must be > 0');
  }

  async create(body: CreateTransactionBody): Promise<{ id: string }> {
    const { type, amount, name, category, timestamp } = body;
    if (type !== 'income' && type !== 'expense') throw new BadRequestException('type must be income or expense');
    this.assertPositive(amount);
    if (!name?.trim()) throw new BadRequestException('name is required');
    await this.assertCategory(category);

    const ts = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(ts.getTime())) throw new BadRequestException('timestamp is invalid');

    const signed = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    const doc = await this.transactionModel.create({
      userId: this.userId,
      userName: 'web',
      // The bot lowercases names; matching keeps search and analytics grouping consistent.
      transactionName: name.trim().toLowerCase(),
      transactionType: type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: signed,
      timestamp: ts,
      category,
      source: 'manual',
    });
    await this.ledger.apply(signed, type, name.trim(), String(doc._id));
    return { id: String(doc._id) };
  }
```

Controller — add `Post` to the imports and:

```typescript
  @Post()
  create(@Body() body: CreateTransactionBody) {
    return this.transactionsService.create(body);
  }
```

(import `CreateTransactionBody` from the service).

- [ ] **Step 4: Run** — `pnpm test transactions.service` → PASS. `pnpm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add api/src/transactions
git commit -m "feat(api): POST /transactions creates a manual transaction and moves the balance"
```

---

### Task 7: `PUT /transactions/:id`

**Files:** same three.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('update', () => {
  const live = (over: Partial<any> = {}) => ({
    _id: 't1', userId: 1, amount: -100, transactionName: 'old', category: 'food',
    transferKind: undefined, ...over,
  });
  beforeEach(() => { mockModel.findOne = jest.fn(); mockModel.updateOne = jest.fn().mockResolvedValue({}); });

  it('applies the net delta when an ordinary expense amount changes', async () => {
    mockModel.findOne.mockResolvedValue(live());
    await service.update('t1', { amount: 130 });
    expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { amount: -130 } });
    expect(ledger.apply).toHaveBeenCalledWith(-30, 'manual', 'old', 't1');
  });

  it('keeps the stored sign: income stays positive', async () => {
    mockModel.findOne.mockResolvedValue(live({ amount: 500 }));
    await service.update('t1', { amount: 450 });
    expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { amount: 450 } });
    expect(ledger.apply).toHaveBeenCalledWith(-50, 'manual', 'old', 't1');
  });

  // These rows never moved the balance; editing them must not either.
  it('does not move the balance for an internal or unresolved row', async () => {
    for (const kind of ['internal', 'unresolved']) {
      ledger.apply.mockClear();
      mockModel.findOne.mockResolvedValue(live({ transferKind: kind }));
      await service.update('t1', { amount: 999 });
      expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { amount: -999 } });
      expect(ledger.apply).not.toHaveBeenCalled();
    }
  });

  it('edits name and category without touching the balance', async () => {
    mockModel.findOne.mockResolvedValue(live());
    await service.update('t1', { name: ' Super ', category: 'other' });
    expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { transactionName: 'super', category: 'other', categoryNeedsReview: false } });
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  it('looks up only live rows and 404s otherwise', async () => {
    mockModel.findOne.mockResolvedValue(null);
    await expect(service.update('gone', { name: 'x' })).rejects.toThrow(NotFoundException);
    expect(mockModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'gone', deletedAt: null }));
  });

  it('rejects an unknown category and a non-positive amount', async () => {
    mockModel.findOne.mockResolvedValue(live());
    await expect(service.update('t1', { category: 'nope' })).rejects.toThrow(/category/);
    await expect(service.update('t1', { amount: -5 })).rejects.toThrow(/amount/);
  });
});
```

Add `import { NotFoundException } from '@nestjs/common';` to the spec.

- [ ] **Step 2: Run to verify it fails** — `service.update is not a function`

- [ ] **Step 3: Implement**

```typescript
export interface UpdateTransactionBody {
  name?: string;
  category?: string;
  amount?: number;
  timestamp?: string;
}

  async update(id: string, body: UpdateTransactionBody): Promise<void> {
    const tx = await this.transactionModel.findOne({ _id: id, userId: this.userId, ...NOT_DELETED });
    if (!tx) throw new NotFoundException();

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (!body.name.trim()) throw new BadRequestException('name is required');
      patch.transactionName = body.name.trim().toLowerCase();
    }
    if (body.category !== undefined) {
      await this.assertCategory(body.category);
      patch.category = body.category;
      patch.categoryNeedsReview = false;
    }
    if (body.timestamp !== undefined) {
      const ts = new Date(body.timestamp);
      if (isNaN(ts.getTime())) throw new BadRequestException('timestamp is invalid');
      patch.timestamp = ts;
    }

    let delta = 0;
    if (body.amount !== undefined) {
      this.assertPositive(body.amount);
      // The stored sign is the direction; never re-derive it from the enum here.
      const newSigned = tx.amount < 0 ? -Math.abs(body.amount) : Math.abs(body.amount);
      patch.amount = newSigned;
      // internal / unresolved rows never moved the balance, so a new amount must not either.
      if (!isNonSpendingTransfer(tx.transferKind)) delta = newSigned - tx.amount;
    }

    if (Object.keys(patch).length === 0) return;

    // Guarded write: the row must still be live and still carry the amount and
    // kind the delta was computed from. A concurrent delete, edit or resolution
    // changes one of those; the filter then misses and nothing is applied.
    // (Review finding: the first draft did a bare updateOne({ _id }) here, which
    // let an edit land on a row another tab had just deleted or resolved.)
    const written = await this.transactionModel.findOneAndUpdate(
      {
        _id: id,
        userId: this.userId,
        ...NOT_DELETED,
        amount: tx.amount,
        transferKind: tx.transferKind ?? null,   // null matches an absent field
      },
      { $set: patch },
    );
    if (!written) throw new ConflictException('transaction changed concurrently; reload and retry');

    if (delta !== 0) {
      try {
        await this.ledger.apply(delta, 'manual', tx.transactionName, id);
      } catch (err) {
        // The amount was stored but the balance did not move. Put the amount
        // back so a retry starts from a consistent row instead of drifting.
        await this.transactionModel.updateOne({ _id: id }, { $set: { amount: tx.amount } });
        throw err;
      }
    }
  }
```

Controller:

```typescript
  @Put(':id')
  @HttpCode(204)
  async update(@Param('id') id: string, @Body() body: UpdateTransactionBody) {
    await this.transactionsService.update(id, body);
  }
```

(add `Put` to the `@nestjs/common` import).

- [ ] **Step 4: Run** → PASS; build clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): PUT /transactions/:id edits a live transaction, moving the balance only when it ever did"`

---

### Task 8: `DELETE /transactions/:id` — soft-delete

- [ ] **Step 1: Write the failing tests**

```typescript
describe('softDelete', () => {
  // One atomic findOneAndUpdate matching only a LIVE row. It returns the
  // pre-image, so the amount we reverse comes from the same operation that won
  // the race. Two concurrent deletes cannot both reverse the balance.
  beforeEach(() => { mockModel.findOneAndUpdate = jest.fn(); mockModel.deleteOne = jest.fn(); });

  it('marks the row deleted atomically and reverses the balance for an ordinary expense', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'uber', transferKind: undefined });
    await service.softDelete('t1');
    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 't1', deletedAt: null }),
      { $set: { deletedAt: expect.any(Date) }, $unset: { recurringId: 1, recurringPeriod: 1 } },
    );
    expect(ledger.reverse).toHaveBeenCalledWith(-100, 'uber', 't1');
    expect(mockModel.deleteOne).not.toHaveBeenCalled();   // never a hard delete
  });

  it('a concurrent second delete finds no live row and reverses nothing', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.softDelete('t1')).rejects.toThrow(NotFoundException);
    expect(ledger.reverse).not.toHaveBeenCalled();
  });

  // A deleted row must leave the partial unique index on
  // (userId, recurringId, recurringPeriod), or the bank email for that period
  // can never be recorded: its create collides with the deleted row and every
  // poll re-parses the mail. Unsetting the link is what frees the slot.
  it('unsets the recurring link so the period can be recorded again', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't2', amount: -20000, transactionName: 'rent', recurringId: 'r1', recurringPeriod: '2026-10' });
    await service.softDelete('t2');
    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $unset: { recurringId: 1, recurringPeriod: 1 } }),
    );
  });

  it('does not touch the balance for internal or unresolved rows', async () => {
    for (const kind of ['internal', 'unresolved']) {
      ledger.reverse.mockClear();
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -100, transferKind: kind });
      await service.softDelete('t1');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalled();
      expect(ledger.reverse).not.toHaveBeenCalled();
    }
  });

  it('404s for a missing or already-deleted row, matching only live rows', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.softDelete('gone')).rejects.toThrow(NotFoundException);
    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'gone', deletedAt: null }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Fails** — `service.softDelete is not a function`

- [ ] **Step 3: Implement**

```typescript
  /**
   * Never removes the document. An email-sourced row must keep its
   * sourceMessageId or the next ingestion poll re-creates it and re-applies
   * the balance.
   */
  async softDelete(id: string): Promise<void> {
    // One atomic step that matches only a LIVE row and marks it. It returns the
    // pre-image, so the amount reversed below comes from the same operation that
    // won the race: two concurrent deletes cannot both reverse the balance.
    //
    // $unset the recurring link so the row leaves the partial unique index on
    // (userId, recurringId, recurringPeriod). Otherwise the bank email for that
    // period can never be recorded — its create collides with this deleted row —
    // and, having no sourceMessageId to dedupe on, is re-parsed on every poll.
    // ($exists: false is not allowed in a partialFilterExpression, so the index
    // itself cannot be taught to ignore deleted rows.)
    const tx = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { $set: { deletedAt: new Date() }, $unset: { recurringId: 1, recurringPeriod: 1 } },
    );
    if (!tx) throw new NotFoundException();
    if (!isNonSpendingTransfer(tx.transferKind)) {
      await this.ledger.reverse(tx.amount, tx.transactionName, id);
    }
  }
```

Controller:

```typescript
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.transactionsService.softDelete(id);
  }
```

- [ ] **Step 4: Run** → PASS; build clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): DELETE /transactions/:id soft-deletes and reverses the balance only if it moved"`

---

### Task 9: `PATCH /transactions/:id/transfer-kind` — resolution

- [ ] **Step 1: Write the failing tests**

```typescript
describe('resolveTransfer', () => {
  beforeEach(() => { mockModel.findOneAndUpdate = jest.fn(); });

  it('resolving to external applies the balance exactly once, by the stored sign', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -20000, transactionName: 'transfer' });
    await service.resolveTransfer('t1', 'external');
    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 't1', transferKind: 'unresolved', deletedAt: null }),
      { $set: { transferKind: 'external' } },
    );
    expect(ledger.apply).toHaveBeenCalledTimes(1);
    expect(ledger.apply).toHaveBeenCalledWith(-20000, 'expense', 'transfer', 't1');
  });

  it('a positive unresolved row resolved external is income', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: 2000, transactionName: 'transferencia recibida' });
    await service.resolveTransfer('t1', 'external');
    expect(ledger.apply).toHaveBeenCalledWith(2000, 'income', 'transferencia recibida', 't1');
  });

  it('resolving to internal moves nothing', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -20000 });
    await service.resolveTransfer('t1', 'internal');
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  // The atomic update is the guard: a row that is not unresolved (or was
  // resolved a moment ago by a racing request) matches nothing → 409.
  it('409s when the row is not unresolved', async () => {
    mockModel.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.resolveTransfer('t1', 'external')).rejects.toThrow(ConflictException);
    expect(ledger.apply).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    await expect(service.resolveTransfer('t1', 'unresolved' as any)).rejects.toThrow(/kind/);
  });
});
```

Add `ConflictException` to the spec's `@nestjs/common` import.

- [ ] **Step 2: Fails** — `service.resolveTransfer is not a function`

- [ ] **Step 3: Implement**

```typescript
  /**
   * The single path from "recorded" to "asserted". The atomic findOneAndUpdate
   * on transferKind: 'unresolved' is the concurrency guard — two racing
   * resolutions cannot both apply the balance.
   */
  async resolveTransfer(id: string, kind: 'internal' | 'external'): Promise<void> {
    if (kind !== 'internal' && kind !== 'external') throw new BadRequestException('kind must be internal or external');
    const tx = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, transferKind: 'unresolved', ...NOT_DELETED },
      { $set: { transferKind: kind } },
    );
    if (!tx) throw new ConflictException('only an unresolved transfer can be resolved');
    if (kind === 'external') {
      await this.ledger.apply(tx.amount, tx.amount < 0 ? 'expense' : 'income', tx.transactionName, id);
    }
  }
```

Controller:

```typescript
  @Patch(':id/transfer-kind')
  @HttpCode(204)
  async resolveTransfer(@Param('id') id: string, @Body() body: { kind: 'internal' | 'external' }) {
    await this.transactionsService.resolveTransfer(id, body.kind);
  }
```

- [ ] **Step 4: Run** → PASS; build clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): PATCH /transactions/:id/transfer-kind resolves an unresolved transfer"`

---

### Task 9b: Post-review corrections to Tasks 6–9 (applied in `0fb9e8c`…`6e86ffd`)

The Phase 2A spec review found four Important gaps in the endpoints as planned above. They were fixed in a follow-up batch; this block records what the shipped code does so the task text above is not read as authoritative where it differs.

- **Rollback on ledger failure, all four endpoints.** Each transitions the row and *then* moves the balance; if the ledger throws, the row is compensated and the error rethrown so a retry is possible and the guard no longer blocks it:
  - `create` → `deleteOne({ _id: doc._id })`. This is the **one permitted hard delete**: a row this call created milliseconds ago with no `sourceMessageId`, the same rule as ingestion's rollback. Leaving it would invite a DELETE that reverses a movement that never happened.
  - `update` → `$set: { amount: tx.amount }` (a co-edited name/category is left as written; it is not money).
  - `softDelete` → `$unset: { deletedAt: 1 }` plus `$set` of `recurringId`/`recurringPeriod` when the pre-image had them.
  - `resolveTransfer` → `$set: { transferKind: 'unresolved' }`.
- **Resolve: 404 vs 409.** On a null match, `exists({ _id, userId, ...NOT_DELETED })` decides: no live row → 404 (spec table), live row not unresolved → 409. No balance moves on either path.
- **JWT guard asserted.** `api/src/transactions/transactions.controller.spec.ts` reads `GUARDS_METADATA` on `TransactionsController` and `RecurringController` and on each handler; verified to fail with the decorator removed.
- **`setCategory` (PATCH `/:id/category`)** now validates against the allow-list like POST/PUT.
- **Validation pinned:** invalid timestamp (create + update), blank name (update), empty-body no-op (update), category case (`'Gym'` passes, `'gym'` rejected).
- **History name casing:** `create` passes `doc.transactionName` (stored lowercase) to the ledger, so history matches the row.
- **`transferKind` typed** as `TransferKind` in both schemas; the union is spelled only in the two `transfer-kind.ts` files.
- **Ingestion counter-leg link** requires `transferKind: 'unresolved'` in its `updateOne` filter for the received-leg case — a received leg the user resolved to `external` in the meantime already moved the balance and must not be flipped to `internal`. The sent-leg case needs no guard: a sent leg is created `internal` directly and is never a resolve target.

### Task 9c: Re-review polish — compensation errors, the no-op guard test, the dangling leg link

**Files:** `api/src/transactions/transactions.service.ts` + spec, `api/src/transactions/transactions.controller.spec.ts`, `api/src/ingestion/ingestion.service.ts` + spec

Five Minors from the re-review of the fix batch. Two are real silent-failure paths; one is a test that cannot fail.

- [ ] **Step 1: A compensation that fails must not mask the ledger error or stay silent.** In every `catch` that runs a compensation (`create` → `deleteOne`, `update` → restore, `softDelete` → un-delete, `resolveTransfer` → back to `unresolved`), the compensation itself can throw — and today its error *replaces* the ledger error and nothing is logged, leaving a row no retry can repair with no trace. Add `private readonly logger = new Logger(TransactionsService.name);` and route every compensation through one helper:

```typescript
  /**
   * Runs a compensation after a failed ledger call, then rethrows the LEDGER
   * error — that is the one worth surfacing. If the compensation itself fails
   * the row is in a state no retry can repair: say so loudly, with the id.
   */
  private async compensate(id: string, what: string, undo: () => Promise<unknown>, ledgerErr: unknown): Promise<never> {
    try {
      await undo();
    } catch (undoErr) {
      this.logger.error(`Rollback of ${what} for ${id} failed; row needs manual repair`, String(undoErr));
    }
    throw ledgerErr;
  }
```
and each catch becomes e.g. `catch (err) { return this.compensate(id, 'delete', () => this.transactionModel.updateOne(…), err); }`.

**Tests (fail first):** for each of the four endpoints, ledger rejects with `new Error('ledger down')` **and** the compensation's model call rejects with `new Error('db down')` → the promise rejects with `'ledger down'` (not `'db down'`), and `logger.error` was called with a message containing the id. Spy with `jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})`.

- [ ] **Step 2: `update`'s compensation restores every patched field**, so a failed request changed nothing. Replace the `amount`-only restore with the pre-image of exactly the keys in `patch`:

```typescript
        const restore: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) restore[k] = (tx as any)[k] ?? null;
        return this.compensate(id, 'update', () => this.transactionModel.updateOne({ _id: id }, { $set: restore }), err);
```
**Test (fail first):** co-edit `{ amount: 130, name: 'New' }`, ledger rejects → `updateOne` called with `$set: { amount: -100, transactionName: 'old' }`.

- [ ] **Step 3: Delete the guard test that cannot fail.** In `transactions.controller.spec.ts` remove `no handler opts out of the class guard`: Nest merges method guards *additively* onto class guards, so there is no opt-out for it to detect. Keep `is protected by JwtAuthGuard at class level`, which does fail with the decorator removed. Add a one-line comment saying why there is no per-method test.

- [ ] **Step 4: The ingestion sent-case leg link must check `matchedCount`.** In `ingestion.service.ts`, where the newly-arrived *sent* leg links a previously-recorded received leg with `updateOne({ _id, transferKind: 'unresolved' }, …)`: if `matchedCount === 0` the received leg was resolved in the meantime — log at `warn` (`Counter leg <id> no longer unresolved; recording <messageId> unlinked`) and create the sent row **without** `matchedLegId`, instead of logging "Matched transfer legs" and pointing at a row that is not internal.

**Test (fail first):** in the sent-then-received leg test's mirror (sent arrives second), mock `updateOne` to resolve `{ matchedCount: 0 }` → the created document has no `matchedLegId` and `logger.warn` was called.

- [ ] **Step 5:** `pnpm test` all green; `pnpm run build` clean.
- [ ] **Step 6: Commit** — `git commit -m "fix(api): log and surface the ledger error when a rollback also fails; restore full pre-image on update; drop the no-op guard test; guard the sent-leg link"`

**Code-quality polish from the Phase 2A review** — a second, separate commit so the money-path fix above stays reviewable on its own:

- [ ] **Step 7: `transactions.service.ts` readability**
  - Rename `update`'s `written` to `matched` and add the one-line why: it is only a truthiness check, whereas `tx` carries the pre-image the delta was computed from.
  - Make every validation message name the field **and** the value, in one form: `amount must be > 0 (got ${amount})`, `type must be income or expense (got ${type})`, `name is required`, `timestamp is invalid (got ${timestamp})`, `unknown category: ${category}`, `kind must be internal or external (got ${kind})`. A 400 in the network tab should say what was wrong.
  - Name all four request shapes: export `SetCategoryBody { category: string }` and `ResolveTransferBody { kind: 'internal' | 'external' }` beside the two existing ones, and use them in the controller — no inline body types.
  - Put `update`'s validations in the same order as `create`'s (type is not editable, so: amount → name → category → timestamp) so the two read as a matched pair.
  - At `resolveTransfer`'s `if (!tx)`, add the why for the second query: it runs only on the failure path, to tell "no live row" (404) from "live but not unresolved" (409); the balance is unreachable from either.
- [ ] **Step 8: Schema comment scope**, both `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts`: "Never hard-delete" is true of rows that have been persisted and returned to a caller; `create`'s rollback and ingestion's rollback hard-delete a row milliseconds old that no caller has seen. Reword to: `Soft-delete marker for every row. Never hard-delete a row once it has been returned to a caller: an email-sourced row must keep its sourceMessageId or the next poll re-creates it.`
- [ ] **Step 9: Spec hygiene** in `transactions.service.spec.ts`
  - Split the mislabeled `describe('exportCsv')`: the seven `findAll` tests move under `describe('findAll')`, the two `setCategory` tests under `describe('setCategory')`, leaving only real export tests under `exportCsv`. No test body changes.
  - In `softDelete` → "does not touch the balance for internal or unresolved rows", tighten `expect(mockModel.findOneAndUpdate).toHaveBeenCalled()` to `toHaveBeenCalledWith(expect.objectContaining({ _id: 't1', deletedAt: null }), expect.anything())`, matching its siblings.
- [ ] **Step 10:** `pnpm test` all green — same count as after Step 5 (the split moves tests, it does not add or remove any); `pnpm run build` clean.
- [ ] **Step 11: Commit** — `git commit -m "refactor(api): name request bodies, uniform validation messages, matched-pair validation order, spec describe hygiene"`

---

### Task 10: `POST /recurring`

**Files:** `api/src/recurring/recurring.service.ts`, `recurring.controller.ts`, and a new `recurring.service.spec.ts` (create it following `transactions.service.spec.ts`'s harness, mocking `CategoriesService.list` as in Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
describe('create', () => {
  it('stores a positive amount, the enum type, and the day', async () => {
    await service.create({ type: 'income', amount: 45000, name: 'Salary', category: 'other', dayOfMonth: 14 });
    expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userName: 'web', transactionName: 'salary', transactionType: TransactionType.INCOME,
      amount: 45000, dayOfMonth: 14, category: 'other', active: true,
    }));
  });

  it('rejects day outside 1..28, bad type, non-positive amount, unknown category, blank name', async () => {
    const ok = { type: 'expense' as const, amount: 1, name: 'x', category: 'food', dayOfMonth: 5 };
    await expect(service.create({ ...ok, dayOfMonth: 0 })).rejects.toThrow(/dayOfMonth/);
    await expect(service.create({ ...ok, dayOfMonth: 29 })).rejects.toThrow(/dayOfMonth/);
    await expect(service.create({ ...ok, dayOfMonth: 5.5 })).rejects.toThrow(/dayOfMonth/);
    await expect(service.create({ ...ok, type: 'x' as any })).rejects.toThrow(/type/);
    await expect(service.create({ ...ok, amount: 0 })).rejects.toThrow(/amount/);
    await expect(service.create({ ...ok, category: 'nope' })).rejects.toThrow(/category/);
    await expect(service.create({ ...ok, name: ' ' })).rejects.toThrow(/name/);
  });
});
```

- [ ] **Step 2: Fails.**

- [ ] **Step 3: Implement** in `recurring.service.ts` (inject `CategoriesService`):

```typescript
export interface CreateRecurringBody {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  dayOfMonth: number;
}

  async create(body: CreateRecurringBody): Promise<{ id: string }> {
    const { type, amount, name, category, dayOfMonth } = body;
    if (type !== 'income' && type !== 'expense') throw new BadRequestException('type must be income or expense');
    if (typeof amount !== 'number' || !(amount > 0)) throw new BadRequestException('amount must be > 0');
    if (!name?.trim()) throw new BadRequestException('name is required');
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) throw new BadRequestException('dayOfMonth must be an integer 1..28');
    const allowed = (await this.categories.list()).map((c) => c.name);
    if (!allowed.includes(category)) throw new BadRequestException(`unknown category: ${category}`);

    const doc = await this.model.create({
      userId: this.userId,
      userName: 'web',
      transactionName: name.trim().toLowerCase(),
      transactionType: type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: Math.abs(amount),          // the cron signs it by type when it fires
      dayOfMonth,
      category,
      active: true,
    });
    return { id: String(doc._id) };
  }
```

Confirm the field names against `api/src/shared/schemas/recurring.schema.ts` (they mirror `repo/`'s: `userId, userName, transactionName, transactionType, amount, category, dayOfMonth, active`).

Controller: add `@Post() create(@Body() body: CreateRecurringBody) { return this.recurringService.create(body); }` with `Post`, `Body` imported.

- [ ] **Step 4: Run** → PASS; build clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): POST /recurring creates a recurring rule"`

---

### Task 11: Bot delete/edit — soft-delete and balance guards

**Files:** `repo/src/service/transaction.service.ts`, `repo/src/service/transaction.service.spec.ts`

The bot is retiring but these two methods are live and corrupt the balance today.

- [ ] **Step 1: Write the failing tests**

The spec's harness: `mockTransactionModel = jest.fn()` with per-method `jest.fn()`s, each mocked as a chain `.mockReturnValue({ exec: jest.fn().mockResolvedValue(value) })`; `mockBalanceService = { getOrCreateBalance, updateBalance, reverseTransaction }`; `service = new TransactionService(mockTransactionModel as any, mockBot as any, mockBalanceService as any)`; `makeCtx()` yields `from.id = 42`. Match it exactly.

**First, update the two pre-existing `deleteTransactionById` tests.** They mock `findOne` + `deleteOne` and assert `reverseTransaction`. Hard-delete becomes soft-delete, so change their `deleteOne` mock to a `findOneAndUpdate` chain resolving the same transaction object; keep their `reverseTransaction` assertions byte-for-byte. That is a legitimate behaviour change, not a weakening.

Then add:

```typescript
  describe('deleteTransactionById — soft delete', () => {
    const chain = (v: any) => ({ exec: jest.fn().mockResolvedValue(v) });
    const live = { _id: 'txid1', transactionType: TransactionType.EXPENSE, amount: -300, transactionName: 'groceries', transferKind: undefined };

    it('soft-deletes atomically, matching only a live row, and reverses the balance', async () => {
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(live));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(live));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid1', userId: 42, deletedAt: null }),
        { $set: { deletedAt: expect.any(Date) }, $unset: { recurringId: 1, recurringPeriod: 1 } },
      );
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(42, -300, 'groceries', 'txid1');
      expect(mockTransactionModel.deleteOne).not.toHaveBeenCalled();   // never a hard delete
    });

    // internal / unresolved rows never moved the balance; deleting them must not either.
    it.each(['internal', 'unresolved'])('does not reverse the balance for a %s row', async (kind) => {
      const row = { ...live, transferKind: kind };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(row));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
    });

    // The atomic update returns null when a concurrent delete already claimed
    // the row: nothing to reverse, and no second reversal.
    it('reverses nothing when a concurrent delete already claimed the row', async () => {
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(live));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(null));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
    });
  });

  describe('updateTransactionAmount — balance guard', () => {
    const chain = (v: any) => ({ exec: jest.fn().mockResolvedValue(v) });

    it('does not move the balance for an unresolved row but still persists the new amount', async () => {
      const row = { _id: 'txid2', transactionType: TransactionType.EXPENSE, amount: -100, transactionName: 'transfer', transferKind: 'unresolved' };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findByIdAndUpdate = jest.fn().mockReturnValue(chain(undefined));
      await service.updateTransactionAmount(42, 'txid2', 150);
      expect(mockTransactionModel.findByIdAndUpdate).toHaveBeenCalledWith('txid2', { amount: -150 });
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
      expect(mockBalanceService.updateBalance).not.toHaveBeenCalled();
    });

    it('still moves the balance for an ordinary row', async () => {
      const row = { _id: 'txid3', transactionType: TransactionType.EXPENSE, amount: -100, transactionName: 'colmado', transferKind: undefined };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findByIdAndUpdate = jest.fn().mockReturnValue(chain(undefined));
      await service.updateTransactionAmount(42, 'txid3', 150);
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(42, -100, 'colmado', 'txid3');
      expect(mockBalanceService.updateBalance).toHaveBeenCalledWith(42, 150, TransactionType.EXPENSE, 'colmado', 'txid3');
    });
  });
```

Every test above except `still moves the balance for an ordinary row` must **fail** before Step 3; that one is the guard against over-correcting.

- [ ] **Step 2: Fails** — `deleteOne` is called / balance is reversed.

- [ ] **Step 3: Implement**

In `deleteTransactionById`, replace the reverse + `deleteOne` block with:

```typescript
      // Soft-delete, atomically, matching only a LIVE row: an ingested row must
      // keep its sourceMessageId or the next poll re-creates it, and two
      // concurrent deletes must not both reverse the balance. The pre-image
      // returned is the amount to reverse. Unset the recurring link so the row
      // leaves the partial unique index on (userId, recurringId, recurringPeriod)
      // — otherwise that period can never be recorded again by email or cron.
      const deleted = await this.transactionModel
        .findOneAndUpdate(
          { _id: transactionId, userId, ...NOT_DELETED },
          { $set: { deletedAt: new Date() }, $unset: { recurringId: 1, recurringPeriod: 1 } },
        )
        .exec();
      if (!deleted) return;   // already deleted by a concurrent request
      if (!isNonSpendingTransfer(deleted.transferKind)) {
        await this.balanceService.reverseTransaction(userId, deleted.amount, deleted.transactionName, transactionId);
      }
```

In `updateTransactionAmount`, wrap both balance calls:

```typescript
    const movesBalance = !isNonSpendingTransfer(tx.transferKind);
    if (movesBalance) await this.balanceService.reverseTransaction(userId, tx.amount, tx.transactionName, txId);
    // ...persist newStoredAmount unchanged...
    if (movesBalance) await this.balanceService.updateBalance(userId, newRawAmount, tx.transactionType as TransactionType, tx.transactionName, txId);
```

Import `isNonSpendingTransfer` from `../type/transfer-kind`. Both lookups (`findOne`) already gained `...NOT_DELETED` in Task 3 — confirm.

- [ ] **Step 4: Run** — `cd repo && npm test` green; `npm run build` clean.
- [ ] **Step 5: Commit** — `git commit -m "fix(bot): soft-delete transactions and never reverse a balance that was never moved"`

---

### Task 12: Categorizer — canonical names and word boundaries

**Files:** `api/src/ingestion/categorizer.service.ts`, `categorizer.service.spec.ts`

> **Corrected after reading the real file.** The existing spec constructs `new CategorizerService()` directly and never mocks Mistral — the fallback is only exercised via "no API key → other". A blanket `\b(?:…)\b` wrapping would **regress** real merchants: several rules are stems (`gasolin`, `clinic`, `cine`, `farmacia`, `supermercado`, `hospital`) that must keep matching `GASOLINERA`, `CLINICA`, `CINEMARK`. The leading `\b` is what kills `MEDICINE`; `\w*` on the stems keeps the Spanish suffixes. And bare `nacional` cannot be saved by boundaries at all — `BANCO NACIONAL` is a whole word — so it is dropped; `supermercado\w*` still catches "SUPERMERCADOS NACIONAL". Note also that the Mistral fallback **always** sets `needsReview: true`; the canonical-name fix changes *which* name is returned, not the review flag.

- [ ] **Step 1: Add a Mistral mock and the failing tests**

At the top of `categorizer.service.spec.ts`, before the imports are used:

```typescript
const complete = jest.fn();
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({ chat: { complete } })),
}));
```

Append a new describe block. Each test constructs a **fresh** service (the client is cached per instance with `??=`):

```typescript
describe('CategorizerService — word boundaries and canonical names', () => {
  const allowed = ['food', 'transport', 'housing', 'health', 'entertainment', 'other', 'Gym'];
  let prevKey: string | undefined;
  beforeEach(() => { prevKey = process.env.MISTRAL_API_KEY; process.env.MISTRAL_API_KEY = 'test-key'; complete.mockReset(); });
  afterEach(() => { if (prevKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = prevKey; });

  const reply = (name: string) => complete.mockResolvedValue({ choices: [{ message: { content: name } }] });

  // The reply is lowercased before matching, but custom categories keep their
  // case. Returning the caller's spelling is what lets 'Gym' ever be assigned.
  it('returns the canonical custom-category name when Mistral answers in another case', async () => {
    reply('gym');
    const r = await new CategorizerService().categorize('BODY SHOP FITNESS', allowed);
    expect(r).toEqual({ category: 'Gym', needsReview: true });
  });

  // 'cine' must not match inside MEDICINE. With no rule hit, the fallback runs.
  it('does not match a rule keyword inside a longer word', async () => {
    reply('health');
    const r = await new CategorizerService().categorize('MEDICINE SHOPPE', allowed);
    expect(complete).toHaveBeenCalled();
    expect(r.category).toBe('health');
  });

  it('still matches a rule keyword as a whole word, without Mistral', async () => {
    const r = await new CategorizerService().categorize('CINE CARIBBEAN', allowed);
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual({ category: 'entertainment', needsReview: false });
  });

  // Regression guards for the stems: these must keep matching by rule.
  it.each([
    ['GASOLINERA SHELL', 'transport'],
    ['CLINICA ABREU', 'health'],
    ['CINEMARK BLUE MALL', 'entertainment'],
    ['SUPERMERCADOS NACIONAL', 'food'],
  ])('keeps matching %s as %s by rule', async (merchant, expected) => {
    const r = await new CategorizerService().categorize(merchant, allowed);
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual({ category: expected, needsReview: false });
  });

  // Words that used to false-positive now fall through to the reviewed fallback.
  it.each([
    ['BANCO NACIONAL'],      // was food via bare 'nacional'
    ['AGUACATE MARKET'],     // was housing via 'agua'
    ['VIVANDA STORE'],       // was housing via 'viva'
  ])('no longer misfiles %s by rule', async (merchant) => {
    reply('other');
    const r = await new CategorizerService().categorize(merchant, allowed);
    expect(complete).toHaveBeenCalled();
    expect(r.needsReview).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `cd api && pnpm test categorizer`. Expected failures: the canonical test gets `other`; MEDICINE gets `entertainment` with `complete` not called; BANCO NACIONAL / AGUACATE / VIVANDA get a rule hit with `needsReview: false`. The stem guards **already pass** — they are there to stay green through Step 3.

- [ ] **Step 3: Implement**

Replace `RULES` with:

```typescript
/**
 * Deterministic rules run first — free, instant, and predictable.
 * Each alternation starts at a word boundary so a keyword cannot match inside
 * a longer word ('cine' in MEDICINE, 'agua' in AGUACATE). Stems carry \w* so
 * Spanish suffixes still match (GASOLINERA, CLINICA, CINEMARK). Bare 'nacional'
 * is deliberately absent: BANCO NACIONAL is a whole word no boundary can exclude.
 */
const RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(?:uber\s*\*?\s*eats|pedidosya|didi\s*food)\b/i, category: 'food' },
  { pattern: /\b(?:uber|didi|taxi|parqueo|gasolin\w*|shell|texaco)\b/i, category: 'transport' },
  { pattern: /\b(?:supermercado\w*|jumbo|sirena|bravo|pricesmart)\b/i, category: 'food' },
  { pattern: /\b(?:farmacia\w*|carol|gbc|hospital\w*|clinic\w*)\b/i, category: 'health' },
  { pattern: /\b(?:edenorte|edesur|edeeste|claro|altice|viva|agua)\b/i, category: 'housing' },
  { pattern: /\b(?:netflix|spotify|hbo|disney|cine\w*|steam)\b/i, category: 'entertainment' },
  { pattern: /\bcajero\s+autom\w*/i, category: 'other' },
];
```

In `askMistral`, replace `return allowed.includes(text) ? text : null;` with:

```typescript
      // Return the caller's canonical spelling: custom categories keep their case
      // ('Gym'), and a lowercased reply must map back to it or it can never be assigned.
      const hit = allowed.find((a) => a.toLowerCase() === text);
      return hit ?? null;
```

- [ ] **Step 4: Run** — `pnpm test categorizer` all green, including the six pre-existing rule tests (`UBER*EATS…`, `PedidosYa*…`, `UBER*RIDES`, `Cajero Automatico`, `FARMACIA CAROL`, `EDENORTE DOMINICANA`) — if any of those breaks, a boundary is wrong; fix the pattern, not the test.
- [ ] **Step 5: Commit** — `git commit -m "fix(ingestion): categorizer returns canonical names and matches rules on word boundaries"`

---

### Task 12b: One source of truth for the category allow-list

The spec's `POST /transactions` section says the allow-list helper is "extracted once and reused by ingestion (which currently carries its own copy)". Review found it was not scheduled. `api/src/ingestion/ingestion.service.ts:21` keeps a private `BUILT_IN` array and queries `CustomCategory` itself (`:149-152`, once per run since batch A5); `api/src/categories/categories.service.ts:6-15` is the real list, with colours and emoji. Two sources drift.

**Files:** `api/src/ingestion/ingestion.module.ts`, `ingestion.service.ts`, `ingestion.service.spec.ts`

- [ ] **Step 1: Failing test.** In `ingestion.service.spec.ts`, replace the `CustomCategory` model provider (`{ provide: getModelToken(CustomCategory.name), useValue: categoryModel }`) with
```typescript
        { provide: CategoriesService, useValue: categories },
```
where `categories = { list: jest.fn().mockResolvedValue([{ name: 'food' }, { name: 'other' }, { name: 'Gym' }]) }` is declared beside the other mocks. Change the load-once assertion (`expect(categoryModel.find).toHaveBeenCalledTimes(1)`) to `expect(categories.list).toHaveBeenCalledTimes(1)`. Add one test: a mail whose merchant Mistral classifies as `'Gym'` is persisted with `category: 'Gym'` — the custom name reaches the categorizer through `list()`. Run → DI failure (`CategoriesService` not injected) — observed red.

- [ ] **Step 2: Implement.**
  - `ingestion.module.ts`: import `CategoriesModule`; remove `CustomCategory` from `forFeature` if nothing else in the module uses it (nothing does).
  - `ingestion.service.ts`: delete `BUILT_IN`; replace the `@InjectModel(CustomCategory.name) categoryModel` constructor param with `private readonly categories: CategoriesService`; replace the run-context build at `:149-152` with
```typescript
      allowed: (await this.categories.list()).map((c) => c.name),
```
    Remove the now-unused `CustomCategory` import.

- [ ] **Step 3:** `pnpm test` all green (the ingestion suite's count unchanged +1); `pnpm run build` clean; `git grep -n "BUILT_IN" -- api/src` hits only `categories.service.ts`.
- [ ] **Step 4: Commit** — `git commit -m "refactor(ingestion): take the category allow-list from CategoriesService instead of a private copy"`

---

## Phase 3 — Web

### Task 13: API client, models, and the two tiny services

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`, `api.service.ts`
- Create: `web/src/app/core/services/transaction-events.service.ts`, `transaction-form.service.ts`

- [ ] **Step 1: Models** — append to `api.models.ts`:

```typescript
export interface CreateTransactionRequest {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  timestamp?: string;
}

export interface UpdateTransactionRequest {
  name?: string;
  category?: string;
  amount?: number;
  timestamp?: string;
}

export interface CreateRecurringRequest {
  type: 'income' | 'expense';
  amount: number;
  name: string;
  category: string;
  dayOfMonth: number;
}
```

- [ ] **Step 2: API calls** — add to `ApiService` (import the three types):

```typescript
  createTransaction(body: CreateTransactionRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/transactions`, body);
  }

  updateTransaction(id: string, body: UpdateTransactionRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/transactions/${id}`, body);
  }

  deleteTransaction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/transactions/${id}`);
  }

  resolveTransfer(id: string, kind: 'internal' | 'external'): Observable<void> {
    return this.http.patch<void>(`${this.base}/transactions/${id}/transfer-kind`, { kind });
  }

  createRecurring(body: CreateRecurringRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/recurring`, body);
  }
```

- [ ] **Step 3: Events service** — `transaction-events.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Emits after any transaction write so open pages can reload immediately. */
@Injectable({ providedIn: 'root' })
export class TransactionEventsService {
  private readonly changedSubject = new Subject<void>();
  readonly changed$ = this.changedSubject.asObservable();
  notify(): void { this.changedSubject.next(); }
}
```

- [ ] **Step 4: Form service** — `transaction-form.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Transaction } from './api.models';

export type FormRequest = { mode: 'create' } | { mode: 'edit'; tx: Transaction };

/** Pages ask the single global form to open; the form lives in AppComponent. */
@Injectable({ providedIn: 'root' })
export class TransactionFormService {
  private readonly requests = new Subject<FormRequest>();
  readonly requests$ = this.requests.asObservable();
  openCreate(): void { this.requests.next({ mode: 'create' }); }
  openEdit(tx: Transaction): void { this.requests.next({ mode: 'edit', tx }); }
}
```

- [ ] **Step 5: Build** — `cd web && pnpm run build` clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): API calls and services for transaction writes"`

---

### Task 14: The overlay form and the floating `+`

**Files:**
- Modify: `web/src/tokens.css`
- Create: `web/src/app/core/ui/transaction-form/transaction-form.component.{ts,html,scss}`
- Create: `web/src/app/core/ui/fab/fab.component.{ts,html,scss}`
- Modify: `web/src/app/app.component.ts`, `app.component.html`

- [ ] **Step 1: Token** — in `web/src/tokens.css`, inside the `:root` block next to the legacy aliases, add:

```css
  --overlay-scrim: oklch(0% 0 0 / 50%);   /* same value the drawer backdrop uses */
```

- [ ] **Step 2: Form component**

`transaction-form.component.ts`:

```typescript
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
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
      this.date     = r.tx.timestamp.slice(0, 10);
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
    const timestamp = this.date ? new Date(this.date + 'T12:00:00').toISOString() : undefined;

    const req = this.mode === 'edit' && this.editing
      ? this.api.updateTransaction(this.editing._id, { name: this.name, category: this.category, amount: this.amount!, timestamp })
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
```

`transaction-form.component.html`:

```html
@if (open) {
  <div class="tf-scrim" (click)="close()" aria-hidden="true"></div>
  <div class="tf-panel card" role="dialog" aria-modal="true" [attr.aria-label]="mode === 'edit' ? 'Edit transaction' : 'New transaction'">
    <div class="tf-header">
      <h2>{{ mode === 'edit' ? 'Edit transaction' : 'New transaction' }}</h2>
      <button class="tf-close" type="button" (click)="close()" aria-label="Close"><mat-icon>close</mat-icon></button>
    </div>

    @if (mode === 'create') {
      <div class="tf-type" role="radiogroup" aria-label="Type">
        <button type="button" class="tf-type-btn" [class.active]="type === 'expense'" (click)="type = 'expense'">
          <mat-icon>arrow_downward</mat-icon> Expense
        </button>
        <button type="button" class="tf-type-btn" [class.active]="type === 'income'" (click)="type = 'income'">
          <mat-icon>arrow_upward</mat-icon> Income
        </button>
      </div>
    }

    <label class="tf-field">
      <span>Amount</span>
      <input #firstField class="tf-input" type="number" min="0.01" step="0.01" [(ngModel)]="amount" placeholder="0.00" />
    </label>
    <label class="tf-field">
      <span>Name</span>
      <input class="tf-input" type="text" [(ngModel)]="name" placeholder="What was it?" />
    </label>
    <label class="tf-field">
      <span>Category</span>
      <select class="tf-input" [(ngModel)]="category">
        @for (cat of categories; track cat) { <option [value]="cat">{{ cat | titlecase }}</option> }
      </select>
    </label>
    <label class="tf-field">
      <span>Date</span>
      <input class="tf-input" type="date" [(ngModel)]="date" />
    </label>

    @if (error) { <p class="tf-error" role="alert">{{ error }}</p> }

    <div class="tf-actions">
      <button type="button" class="tf-cancel" (click)="close()">Cancel</button>
      <button type="button" class="tf-submit" [disabled]="!valid || saving" (click)="save()">
        <mat-icon>{{ saving ? 'hourglass_empty' : 'check' }}</mat-icon>
        {{ saving ? 'Saving…' : (mode === 'edit' ? 'Save changes' : 'Add') }}
      </button>
    </div>
  </div>
}
```

`transaction-form.component.scss` (tokens only; the field styles mirror the budget form's `bf-*`):

```scss
:host { display: contents; }

.tf-scrim {
  position: fixed; inset: 0;
  background: var(--overlay-scrim);
  z-index: 1100;
}

.tf-panel {
  position: fixed; z-index: 1101;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(440px, calc(100vw - 32px));
  padding: 20px;
  display: flex; flex-direction: column; gap: 12px;
}

.tf-header { display: flex; align-items: center; justify-content: space-between;
  h2 { margin: 0; font-size: 1.1rem; }
}
.tf-close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 8px;
  &:hover { background: var(--color-surface-hover); }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
}

.tf-type { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tf-type-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border-radius: 10px; cursor: pointer;
  background: var(--bg-card-alt); border: 1px solid var(--border); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.875rem;
  &.active { border-color: var(--color-accent); color: var(--text); background: var(--color-accent-subtle); }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
}

.tf-field { display: flex; flex-direction: column; gap: 4px;
  span { font-size: 0.75rem; color: var(--text-muted); }
}
.tf-input {
  background: var(--bg-card-alt); border: 1px solid var(--border); border-radius: 10px;
  color: var(--text); font-size: 0.875rem; font-family: var(--font-body);
  padding: 9px 14px; outline: none; transition: border-color 0.15s;
  &:focus-visible { border-color: var(--color-accent); }
}

.tf-error { margin: 0; color: var(--expense); font-size: 0.8rem; }

.tf-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.tf-cancel {
  background: none; border: 1px solid var(--border); border-radius: 10px;
  color: var(--text-muted); padding: 9px 14px; cursor: pointer; font-family: var(--font-body);
  &:hover { background: var(--color-surface-hover); }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
}
.tf-submit {
  display: flex; align-items: center; gap: 6px;
  background: var(--accent); color: var(--color-accent-ink); border: none; border-radius: 10px;
  padding: 9px 16px; font-size: 0.875rem; font-family: var(--font-body); font-weight: 600; cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
}

@media (max-width: 480px) {
  .tf-panel { left: 0; top: auto; bottom: 0; transform: none; width: 100vw; border-radius: 16px 16px 0 0; }
}
```

- [ ] **Step 3: FAB component**

`fab.component.ts`:

```typescript
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TransactionFormService } from '../../services/transaction-form.service';

@Component({
  selector: 'app-fab',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './fab.component.html',
  styleUrls: ['./fab.component.scss'],
})
export class FabComponent {
  constructor(private formSvc: TransactionFormService) {}
  open() { this.formSvc.openCreate(); }
}
```

`fab.component.html`:

```html
<button class="fab" type="button" (click)="open()" aria-label="Add transaction" title="Add transaction">
  <mat-icon>add</mat-icon>
</button>
```

`fab.component.scss` — all eight states, tokens only:

```scss
.fab {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 150;                             /* under the mobile drawer (199/200) and dropdowns (1000) */
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: var(--color-accent-ink);
  border: none; cursor: pointer;
  box-shadow: 0 8px 24px var(--overlay-scrim);
  transition: transform 0.12s, filter 0.12s;
  mat-icon { font-size: 26px; width: 26px; height: 26px; }

  &:hover, &.is-hover         { filter: brightness(1.08); }
  &:focus-visible, &.is-focus { outline: 2px solid var(--color-focus); outline-offset: 3px; }
  &:active, &.is-active       { transform: scale(0.94); }
  &:disabled, &.is-disabled   { opacity: 0.5; cursor: not-allowed; }
  &[data-state="loading"]     { pointer-events: none; mat-icon { animation: fab-spin 1s linear infinite; } }
  &[data-state="error"]       { background: var(--expense); }
  &[data-state="success"]     { background: var(--income); }
}

@keyframes fab-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .fab { transition: none; }
  .fab[data-state="loading"] mat-icon { animation: none; }
}
```

- [ ] **Step 4: Mount in the shell**

In `app.component.ts` add `FabComponent` and `TransactionFormComponent` to the `imports` array (import both). In `app.component.html`, inside `.main` after the `.content` div:

```html
    <app-fab />
    <app-transaction-form />
```

- [ ] **Step 5: Build** — `cd web && pnpm run build` clean. Then start the dev preview and confirm: the `+` shows on every route; clicking opens the overlay; Escape and the scrim close it; on a 375px viewport the panel is a bottom sheet with no horizontal scroll.

- [ ] **Step 6: Commit** — `git commit -m "feat(web): floating + button and overlay transaction form"`

---

### Task 15: Transactions page — row actions and live reload

**Files:** `web/src/app/pages/transactions/transactions.component.{ts,html,scss}`

- [ ] **Step 1: Component** — inject `TransactionEventsService` and `TransactionFormService`; subscribe in `ngOnInit` (`this.events.changed$.subscribe(() => { this.offset = 0; this.load(false); })`), unsubscribe in `ngOnDestroy` (add `OnDestroy`). Delete the `reviewCategories` getter and point the template's needs-review `@for` at `categories`. Add:

```typescript
  confirmingDelete: string | null = null;

  edit(tx: Transaction)  { this.formSvc.openEdit(tx); }
  askDelete(tx: Transaction) { this.confirmingDelete = tx._id; }
  cancelDelete()         { this.confirmingDelete = null; }
  confirmDelete(tx: Transaction) {
    this.api.deleteTransaction(tx._id).subscribe({
      next: () => { this.confirmingDelete = null; this.events.notify(); },
      error: () => { this.confirmingDelete = null; alert('Could not delete. Please try again.'); },
    });
  }
  resolve(tx: Transaction, kind: 'internal' | 'external') {
    this.api.resolveTransfer(tx._id, kind).subscribe({
      next: () => this.events.notify(),
      error: () => alert('Could not resolve this transfer.'),
    });
  }
  isTransfer(tx: Transaction) { return tx.transferKind === 'internal' || tx.transferKind === 'unresolved'; }
```

Use `isTransfer(tx)` in the template instead of the three inline `===` chains.

- [ ] **Step 2: Template** — add a header cell `<span class="align-right">ACTIONS</span>` and, as the last cell of each row:

```html
          <div class="tx-cell align-right tx-actions">
            @if (tx.transferKind === 'unresolved') {
              <button class="act-btn" (click)="resolve(tx, 'internal')" title="Money moved between my own accounts">Internal</button>
              <button class="act-btn" (click)="resolve(tx, 'external')" title="A real payment or income">Expense</button>
            }
            @if (confirmingDelete === tx._id) {
              <button class="act-btn danger" (click)="confirmDelete(tx)">Confirm</button>
              <button class="act-btn" (click)="cancelDelete()">Cancel</button>
            } @else {
              <button class="icon-act" (click)="edit(tx)" aria-label="Edit"><mat-icon>edit</mat-icon></button>
              <button class="icon-act" (click)="askDelete(tx)" aria-label="Delete"><mat-icon>delete_outline</mat-icon></button>
            }
          </div>
```

Adjust the table's grid template in the scss to add the column (read the existing `.tx-table-header` / `.tx-row` grid definition and append a `minmax(0, auto)` track).

- [ ] **Step 3: Styles** — append, tokens only:

```scss
.tx-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.act-btn {
  background: var(--bg-card-alt); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-family: var(--font-body); font-size: 0.75rem; padding: 4px 10px; cursor: pointer;
  &:hover { background: var(--color-surface-hover); }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  &.danger { border-color: var(--expense); color: var(--expense); }
}
.icon-act {
  background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 8px;
  mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
  &:hover { background: var(--color-surface-hover); color: var(--text); }
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
}
```

- [ ] **Step 4: Build + preview** — build clean; in the preview: edit a row (form opens prefilled), delete (inline confirm, row disappears, dashboard balance changes), an `unresolved` row shows the two buttons, no horizontal scroll at 375px.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): edit, delete and resolve actions on the transactions page"`

---

### Task 16: Recurring create form, dashboard tag and live reload

**Files:** `web/src/app/pages/recurring/recurring.component.{ts,html,scss}`, `web/src/app/pages/dashboard/dashboard.component.{ts,html}`

- [ ] **Step 1: Recurring** — add `FormsModule` to the component's `imports`; add fields and a method:

```typescript
  showForm = false; saving = false;
  fType: 'income' | 'expense' = 'expense'; fAmount: number | null = null; fName = ''; fCategory = 'other'; fDay = 1;
  get categories(): string[] { return this.catSvc.all.map(c => c.name); }
  get formValid() { return !!this.fAmount && this.fAmount > 0 && !!this.fName.trim() && this.fDay >= 1 && this.fDay <= 28; }

  submitForm() {
    if (!this.formValid || this.saving) return;
    this.saving = true;
    this.api.createRecurring({ type: this.fType, amount: this.fAmount!, name: this.fName, category: this.fCategory, dayOfMonth: this.fDay })
      .subscribe({
        next: () => { this.saving = false; this.showForm = false; this.fAmount = null; this.fName = ''; this.load(); },
        error: () => { this.saving = false; this.error = 'Could not create the rule.'; },
      });
  }
```

Template — in `.rp-header`, after the title block:

```html
    <button class="rp-new-btn" (click)="showForm = !showForm"><mat-icon>add</mat-icon> New Rule</button>
```

and directly after the header:

```html
  @if (showForm) {
    <div class="rp-form-row card">
      <select class="rf-input" [(ngModel)]="fType"><option value="expense">Expense</option><option value="income">Income</option></select>
      <input class="rf-input" type="number" min="0.01" step="0.01" [(ngModel)]="fAmount" placeholder="Amount" />
      <input class="rf-input" type="text" [(ngModel)]="fName" placeholder="Name (e.g. salary, rent)" />
      <select class="rf-input" [(ngModel)]="fCategory">@for (c of categories; track c) { <option [value]="c">{{ c | titlecase }}</option> }</select>
      <input class="rf-input rf-day" type="number" min="1" max="28" [(ngModel)]="fDay" placeholder="Day" />
      <button class="rf-submit" [disabled]="!formValid || saving" (click)="submitForm()">
        <mat-icon>{{ saving ? 'hourglass_empty' : 'check' }}</mat-icon> {{ saving ? 'Saving…' : 'Create' }}
      </button>
    </div>
  }
```

Add `TitleCasePipe` to imports. Styles: `.rp-form-row` flex-wrap with 12px gap; `.rf-input` identical to the `.tf-input` rule in Task 14; `.rf-day { width: 80px; }`; `.rp-new-btn` and `.rf-submit` identical to `.tf-submit`. Tokens only.

- [ ] **Step 2: Dashboard** — inject `TransactionEventsService`; in `ngOnInit` subscribe to `changed$` and re-run the same `forkJoin` the 60s timer runs (extract it into a private `refresh()` and call it from both). In the recent-transactions row, replace the icon and amount bindings with the transactions page's transfer-aware versions:

```html
          <div class="tx-icon" [class]="(tx.transferKind === 'internal' || tx.transferKind === 'unresolved') ? '' : (tx.isExpense ? 'expense-icon' : 'income-icon')">
```
```html
          @if (tx.transferKind === 'internal' || tx.transferKind === 'unresolved') {
            <span class="tx-amount transfer">{{ tx.transferKind === 'internal' ? 'Internal' : 'Unresolved' }} · {{ tx.amount | currency:'USD':'symbol':'1.2-2' }}</span>
          } @else {
            <span class="tx-amount" [class]="tx.isExpense ? 'expense' : 'income'">
              {{ tx.isExpense ? '-' : '+' }}{{ tx.amount | currency:'USD':'symbol':'1.2-2' }}
            </span>
          }
```

with `.tx-amount.transfer { color: var(--text-muted); }` in the dashboard scss.

- [ ] **Step 3: Build + preview** — clean; creating from the `+` on the dashboard updates the balance card and the recent list without waiting for the 60s timer; the recurring form creates a rule and the list + Sankey refresh.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): recurring create form; dashboard tags transfers and reloads on writes"`

---

## Final verification

```bash
cd api && pnpm test && pnpm run build
```
```bash
cd repo && npm test && npm run build
```
```bash
cd web && pnpm run build
```
```bash
git grep -n "\$nin: \['internal'" -- api/src repo/src        # only transfer-kind.ts
git grep -nE "deleteOne\(\{ *_id" -- api/src repo/src          # no hard deletes of transactions remain
git diff <start>..HEAD | grep -nE "6728|0010|1311|7574|4492|SUERO|ANDUJAR|KENNY|JANIA|JOEL|sueroandujar" || echo clean
```

---

## Plan self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Floating `+` on every page, overlay form, 8 states, tokens | 14 |
| Soft-delete always; `sourceMessageId` retained | 2, 8, 11 |
| Balance moves only for rows that moved it (edit/delete) | 7, 8, 11 |
| Resolution endpoint + web action; balance once; atomic guard | 9, 15 |
| `POST /recurring` for the salary rule | 10, 16 |
| Shared `NOT_DELETED` / `SPENDING_ONLY`, 21 literals replaced | 1, 3 |
| `deletedAt` on both schemas | 2 |
| `source: 'manual'` | 6 |
| Email-sourced amount edits allowed with history | 7 |
| JWT guard on new routes | 9b — pinned by `transactions.controller.spec.ts` via `GUARDS_METADATA` on both controllers (the first draft waived this as "inherited"; the spec said asserted, and review held it to that) |
| Recent-transactions card tags transfers | 16 |
| Live reload after writes | 13, 15, 16 |
| Categorizer canonical names + word boundaries | 12 |
| `reviewCategories` duplicate removed | 15 |
| JS re-spellings use `isNonSpendingTransfer` (spec: shared filters) | 4c |
| Atomic balance movement (Phase 1 review) | 4b |
| Bot: shared filters and balance guards, no new features | 3, 11 |

**Placeholder scan:** Task 11's tests are described with the assertions to make rather than full mock plumbing because they must match `repo/`'s existing hand-built mocks; every assertion is named. Task 12 gives the exact regex transformation and the exact replacement lines. No "add validation" or "similar to Task N".

**Type consistency:** `LedgerService.apply(delta, reason, name?, id?)` is used with that signature in Tasks 4, 6, 7, 9; `reverse(storedAmount, name?, id?)` in 4, 8. `isNonSpendingTransfer`, `NOT_DELETED`, `SPENDING_ONLY` are the same names in both packages (Task 1) and used in 3, 7, 8, 9, 11. `CreateTransactionBody`/`UpdateTransactionBody` (api) mirror `CreateTransactionRequest`/`UpdateTransactionRequest` (web). `TransactionFormService.openEdit(tx)` is called from Task 15 with the `Transaction` model defined in Task 13.
