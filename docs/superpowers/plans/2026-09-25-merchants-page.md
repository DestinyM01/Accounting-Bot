# Merchants Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/merchants` page that lists every merchant the app files on its own and lets the user change, forget or add one. Changing a merchant moves its rows still in the old category. The Transactions review cell handles a guess that names a deleted category.

**Architecture:**
- **Api.** `MerchantMemoryService` (`api/src/merchants/`) already learns choices and hands ingestion its snapshot. It gains `list`, `match`, `add`, `change` and `forget`. All of them, plus the existing learning, share one private query for "a merchant's rows" (live bank-mail expenses that aren't ATM withdrawals or own-account transfers), filtered in code by `merchantKey()`. A new `MerchantsController` exposes the operations, and `MerchantsModule` imports `CategoriesModule` for the active category list.
- **Web.** A standalone `MerchantsComponent` (Angular 17) follows the Categories page's patterns: a `mode` union, `busy`, a `gen` counter against stale loads, focus by element id, and a reload through `TransactionEventsService.changed$`.

**Tech Stack:** NestJS 10, Mongoose 8, Jest (`api/`, pnpm), Angular 17 standalone with no test runner (`web/`, verified by a clean `ng build`).

**Spec:** `docs/superpowers/specs/2026-09-25-merchants-page-design.md`

**Baseline:** `cd api && npx jest` gives 63 suites and 674 tests, all passing.

**Repo rules (every task):**
- The repo is PUBLIC. Use no real names, account numbers, emails or transaction ids in code, tests or commit messages. Use made-up merchants only ("PRIME VIDEO*2K3JD", "UBER *TRIP 4X2", "SOME STORE").
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't push. The controller pushes at the end.

---

## File structure

| File | Responsibility |
|---|---|
| `api/src/merchants/merchant-memory.service.ts` (modify) | Merchant memory: learning, the ingestion snapshot, and the page's operations, sharing one merchant-rows query |
| `api/src/merchants/merchant-memory.service.spec.ts` (modify) | Unit tests for all of the above |
| `api/src/merchants/merchants.controller.ts` (create) | `GET/POST /merchants`, `GET /merchants/match`, `PATCH/DELETE /merchants/:id` |
| `api/src/merchants/merchants.controller.spec.ts` (create) | Status-code pins, argument passing, and a module-wiring check |
| `api/src/merchants/merchants.module.ts` (modify) | Imports `CategoriesModule`; registers the controller |
| `api/src/transactions/transactions.controller.spec.ts` (modify) | Adds `MerchantsController` to the class-level guard pin |
| `web/src/app/core/services/api.models.ts` (modify) | `RememberedMerchant`, `MerchantMatch` |
| `web/src/app/core/services/api.service.ts` (modify) | Five merchant calls |
| `web/src/app/core/services/category.service.ts` (modify) | `loaded` flag |
| `web/src/app/pages/transactions/transactions.component.{ts,html}` (modify) | The deleted-guess review cell |
| `web/src/app/pages/merchants/merchants.component.{ts,html,scss}` (create) | The page |
| `web/src/app/app.routes.ts`, `web/src/app/app.component.ts` (modify) | Route and sidebar item |
| `README.md` (modify) | A "Merchants" feature row |

---

### Task 1: One merchant-rows query; the snapshot skips cash and other

**Files:**
- Modify: `api/src/merchants/merchant-memory.service.ts`
- Test: `api/src/merchants/merchant-memory.service.spec.ts`

The existing tests pin `learn()`'s exact queries. They must still pass unchanged after this refactor, and that is what proves the refactor safe.

- [ ] **Step 1: Write the failing test.** Add this test inside the `describe('MerchantMemoryService', …)` block of `merchant-memory.service.spec.ts`, after the existing test `'hands ingestion every remembered merchant'`:

```ts
  it('never hands ingestion a remembered cash or other', async () => {
    // A category deleted with a move into Other also moves its remembered merchants there.
    memoryModel.find.mockReturnValue(
      query([
        { key: 'some store', category: 'other' },
        { key: 'atm place', category: 'cash' },
        { key: 'prime video', category: 'entertainment' },
      ]),
    );
    const map = await service.all();
    expect([...map.entries()]).toEqual([['prime video', 'entertainment']]);
  });
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts -t "never hands ingestion"`
Expected: FAIL, because the map also holds `some store` and `atm place`.

- [ ] **Step 3: Implement.** Replace the whole of `api/src/merchants/merchant-memory.service.ts` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, NON_SPENDING_KINDS, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { Category } from '../shared/schemas/category.enum';
import { merchantKey } from './merchant-key';

/** The fields of a transaction that decide whether, and what, a category choice teaches. */
export interface TeachableRow {
  _id: unknown;
  source?: string;
  amount: number;
  isWithdrawal?: boolean;
  transferKind?: string | null;
  merchant?: string;
  transactionName?: string;
}

/** The names a row carries; its merchant key comes from `merchant` first, else `transactionName`. */
interface NamedRow {
  _id: unknown;
  merchant?: string;
  transactionName?: string;
}

const keyOf = (t: NamedRow): string => merchantKey(t.merchant || t.transactionName);

/**
 * cash is only for ATM cash, and other is the "don't know" bucket:
 * remembering either would skip the AI for that merchant forever.
 */
const NEVER_REMEMBERED: readonly string[] = [Category.CASH, Category.OTHER];

/**
 * A merchant's rows are the user's live bank-mail expenses that aren't ATM
 * withdrawals or transfers between own accounts, filtered in code by key.
 * Only these rows teach, get filed, get counted and get moved.
 */
const MERCHANT_ROWS = {
  source: 'email',
  amount: { $lt: 0 },
  isWithdrawal: { $ne: true },
  transferKind: { $nin: [...NON_SPENDING_KINDS] },
  ...NOT_DELETED,
};

/**
 * Remembers the category the user chose for each bank merchant, so the next
 * charge from it is filed without review, and files the merchant's other rows
 * still waiting for review. Only bank-mail expenses teach: income, ATM
 * withdrawals (always cash) and transfers between own accounts never do.
 */
@Injectable()
export class MerchantMemoryService {
  private readonly logger = new Logger(MerchantMemoryService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(MerchantCategory.name) private readonly memoryModel: Model<MerchantCategory>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  /** Every remembered merchant key → category, for one ingestion run. */
  async all(): Promise<Map<string, string>> {
    const rows = await this.memoryModel.find({ userId: this.userId }).lean();
    // A category deleted with a move into Other moves its remembered merchants there too;
    // "don't know" is never remembered, so such an entry is skipped rather than obeyed.
    return new Map(rows.filter((r) => !NEVER_REMEMBERED.includes(r.category)).map((r) => [r.key, r.category]));
  }

  /**
   * Called after the user set `category` on `row` (as it was before the change).
   * Returns how many other waiting rows it filed. Never throws: the user's change
   * is already saved, so a failure here is only logged.
   */
  async learn(row: TeachableRow, category: string): Promise<number> {
    if (NEVER_REMEMBERED.includes(category)) return 0;
    const key = keyOf(row);
    const teaches =
      row.source === 'email' && row.amount < 0 && !row.isWithdrawal && !isNonSpendingTransfer(row.transferKind) && key !== '';
    if (!teaches) return 0;
    try {
      await this.memoryModel.updateOne(
        { userId: this.userId, key },
        { $set: { category, updatedAt: new Date() } },
        { upsert: true },
      );
      return await this.fileWaiting(key, category, row._id);
    } catch (err) {
      this.logger.error(`Could not remember ${category} for "${key}"`, err instanceof Error ? err.stack : String(err));
      return 0;
    }
  }

  /** The merchant rows (MERCHANT_ROWS) that also match `extra`, with only their names. */
  private async merchantRows(extra: FilterQuery<Transaction> = {}): Promise<NamedRow[]> {
    return await this.txModel
      .find({ userId: this.userId, ...MERCHANT_ROWS, ...extra })
      .select('merchant transactionName')
      .lean<NamedRow[]>();
  }

  /** Files the rows from `key` still waiting for review (all but `exceptId`) under `category`; returns how many. */
  private async fileWaiting(key: string, category: string, exceptId?: unknown): Promise<number> {
    const waiting = await this.merchantRows({
      categoryNeedsReview: true,
      ...(exceptId === undefined ? {} : { _id: { $ne: exceptId } }),
    });
    const ids = waiting.filter((t) => keyOf(t) === key).map((t) => t._id);
    if (ids.length === 0) return 0;
    const res = await this.txModel.updateMany(
      { _id: { $in: ids }, categoryNeedsReview: true, ...NOT_DELETED },
      { $set: { category, categoryNeedsReview: false } },
    );
    return res.modifiedCount;
  }
}
```

- [ ] **Step 4: Run the whole spec file.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts`
Expected: every test passes, including the unchanged `learn()` tests.

- [ ] **Step 5: Commit.**

```bash
git add api/src/merchants/merchant-memory.service.ts api/src/merchants/merchant-memory.service.spec.ts
git commit -m "refactor(api): one merchant-rows query; ingestion never obeys a remembered cash or other

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `list()` and `match()`

**Files:**
- Modify: `api/src/merchants/merchant-memory.service.ts`
- Modify: `api/src/merchants/merchants.module.ts`
- Test: `api/src/merchants/merchant-memory.service.spec.ts`

- [ ] **Step 1: Give the spec a categories mock and the richer model mocks.** In `merchant-memory.service.spec.ts`, make these changes.

Replace the import lines at the top with:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { MerchantMemoryService } from './merchant-memory.service';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CategoriesService } from '../categories/categories.service';
```

Add this constant after the `row` helper:

```ts
/** The query for a merchant's rows: the user's live bank-mail expenses, no withdrawals, no own-account transfers. */
const MERCHANT_ROWS = {
  userId: 1,
  source: 'email',
  amount: { $lt: 0 },
  isWithdrawal: { $ne: true },
  transferKind: { $nin: ['internal', 'unresolved'] },
  deletedAt: null,
};
```

Replace the `let` declarations and the whole `beforeEach` with:

```ts
  let service: MerchantMemoryService;
  let memoryModel: { updateOne: jest.Mock; find: jest.Mock; findOne: jest.Mock; create: jest.Mock; deleteOne: jest.Mock };
  let txModel: { find: jest.Mock; updateMany: jest.Mock };
  let categories: { list: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    memoryModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      create: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    txModel = { find: jest.fn(() => query([])), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) };
    // Active categories; 'gym' is absent because it was deleted.
    categories = {
      list: jest.fn().mockResolvedValue(['food', 'entertainment', 'transport', 'cash', 'other'].map((name) => ({ name }))),
    };
    const mod = await Test.createTestingModule({
      providers: [
        MerchantMemoryService,
        { provide: getModelToken(MerchantCategory.name), useValue: memoryModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: CategoriesService, useValue: categories },
      ],
    }).compile();
    service = mod.get(MerchantMemoryService);
  });
```

- [ ] **Step 2: Write the failing tests.** Add them at the end of the outer `describe` block:

```ts
  describe('list', () => {
    it('shows every remembered merchant with its booked rows, sorted by name', async () => {
      memoryModel.find.mockReturnValue(
        query([
          { _id: 'm2', key: 'some store', category: 'food', updatedAt: new Date('2026-09-20T12:00:00Z') },
          { _id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: new Date('2026-09-25T12:00:00Z') },
        ]),
      );
      const rows = query([
        { _id: 't1', merchant: 'PRIME VIDEO*2K3JD' },
        { _id: 't2', transactionName: 'prime video*9xq1' },
        { _id: 't3', merchant: 'SOME STORE #12' },
        { _id: 't4', merchant: 'ANOTHER SHOP' },
      ]);
      txModel.find.mockReturnValue(rows);
      await expect(service.list()).resolves.toEqual([
        { id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: new Date('2026-09-25T12:00:00Z'), rows: 2, usable: true },
        { id: 'm2', key: 'some store', category: 'food', updatedAt: new Date('2026-09-20T12:00:00Z'), rows: 1, usable: true },
      ]);
      expect(memoryModel.find).toHaveBeenCalledWith({ userId: 1 });
      expect(txModel.find).toHaveBeenCalledWith(MERCHANT_ROWS);
      expect(rows.select).toHaveBeenCalledWith('merchant transactionName');
    });

    it('shows a merchant with no booked rows and no date as 0 rows and a null date', async () => {
      memoryModel.find.mockReturnValue(query([{ _id: 'm1', key: 'uber trip', category: 'transport' }]));
      await expect(service.list()).resolves.toEqual([
        { id: 'm1', key: 'uber trip', category: 'transport', updatedAt: null, rows: 0, usable: true },
      ]);
    });

    it.each([
      ['a deleted category', 'gym'],
      ['cash', 'cash'],
      ['other', 'other'],
    ])('marks a merchant remembered as %s as not usable', async (_label, category) => {
      memoryModel.find.mockReturnValue(query([{ _id: 'm1', key: 'some store', category, updatedAt: null }]));
      const [m] = await service.list();
      expect(m.usable).toBe(false);
    });
  });

  describe('match', () => {
    it('previews the key a typed name produces, its booked rows and the category already remembered', async () => {
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }, { _id: 't2', merchant: 'UBER *EATS' }]));
      memoryModel.findOne.mockReturnValue(query({ category: 'transport' }));
      await expect(service.match('Uber *Trip 99Z')).resolves.toEqual({ key: 'uber trip', rows: 1, remembered: 'transport' });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ userId: 1, key: 'uber trip' });
      expect(txModel.find).toHaveBeenCalledWith(MERCHANT_ROWS);
    });

    it('says nothing is remembered for a new merchant', async () => {
      await expect(service.match('UBER *TRIP')).resolves.toEqual({ key: 'uber trip', rows: 0, remembered: null });
    });

    it.each([
      ['only codes', '12345 #99'],
      ['a parser placeholder', 'Transferencia'],
      ['a generic word', 'PAYPAL'],
      ['a missing name', undefined],
      ['a repeated query parameter', ['uber', 'trip']],
      ['an over-long name', 'x'.repeat(201)],
    ])('gives an empty key for %s, without querying', async (_label, name) => {
      await expect(service.match(name)).resolves.toEqual({ key: '', rows: 0, remembered: null });
      expect(txModel.find).not.toHaveBeenCalled();
      expect(memoryModel.findOne).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 3: Run them and watch them fail.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts`
Expected: the new tests fail with `service.list is not a function` and `service.match is not a function`.

- [ ] **Step 4: Implement.** In `merchant-memory.service.ts`:

1. Add this import:

```ts
import { CategoriesService } from '../categories/categories.service';
```

2. After the `TeachableRow` interface, add:

```ts
/** A remembered merchant as the Merchants page shows it. */
export interface RememberedMerchant {
  id: string;
  key: string;
  category: string;
  updatedAt: Date | null;
  /** How many booked rows (MERCHANT_ROWS) carry this key. */
  rows: number;
  /** False when its category was deleted, or is cash or other: ingestion then ignores it. */
  usable: boolean;
}

/** What a typed merchant name would match. An empty key means it can't identify a merchant. */
export interface MerchantMatch {
  key: string;
  rows: number;
  remembered: string | null;
}

/** The longest merchant name accepted; bank names are far shorter. */
const MAX_NAME = 200;
```

3. Change the constructor to:

```ts
  constructor(
    @InjectModel(MerchantCategory.name) private readonly memoryModel: Model<MerchantCategory>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    private readonly categories: CategoriesService,
  ) {}
```

4. Add these public methods after `learn()`:

```ts
  /** Every remembered merchant, sorted by key, with its booked rows and whether its category can still be used. */
  async list(): Promise<RememberedMerchant[]> {
    const [entries, rows, usable] = await Promise.all([
      this.memoryModel.find({ userId: this.userId }).lean(),
      this.merchantRows(),
      this.usableCategories(),
    ]);
    const counts = new Map<string, number>();
    for (const t of rows) {
      const key = keyOf(t);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return entries
      .map((e) => ({
        id: String(e._id),
        key: e.key,
        category: e.category,
        updatedAt: e.updatedAt ?? null,
        rows: counts.get(e.key) ?? 0,
        usable: usable.has(e.category),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** The key a typed name produces, how many booked rows carry it, and the category already remembered for it. */
  async match(name: unknown): Promise<MerchantMatch> {
    const key = typeof name === 'string' && name.length <= MAX_NAME ? merchantKey(name) : '';
    if (!key) return { key: '', rows: 0, remembered: null };
    const [rows, entry] = await Promise.all([
      this.merchantRows(),
      this.memoryModel.findOne({ userId: this.userId, key }).lean(),
    ]);
    return { key, rows: rows.filter((t) => keyOf(t) === key).length, remembered: entry?.category ?? null };
  }
```

5. Add this private method before `merchantRows()`:

```ts
  /** The active categories a merchant can be remembered under. */
  private async usableCategories(): Promise<Set<string>> {
    const names = (await this.categories.list()).map((c) => c.name);
    return new Set(names.filter((n) => !NEVER_REMEMBERED.includes(n)));
  }
```

6. In `api/src/merchants/merchants.module.ts`, import `CategoriesModule`. There's no cycle: `CategoriesModule` imports neither this module nor `TransactionsModule`.

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MerchantCategory, MerchantCategorySchema } from '../shared/schemas/merchant-category.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CategoriesModule } from '../categories/categories.module';
import { MerchantMemoryService } from './merchant-memory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MerchantCategory.name, schema: MerchantCategorySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    CategoriesModule,
  ],
  providers: [MerchantMemoryService],
  exports: [MerchantMemoryService],
})
export class MerchantsModule {}
```

- [ ] **Step 5: Run the spec file, then the whole suite.** Other suites build the service through mocks, so check that nothing broke.

Run: `cd api && npx jest src/merchants && npx jest`
Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add api/src/merchants
git commit -m "feat(api): list remembered merchants with their rows; preview what a typed name matches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `add()`

**Files:**
- Modify: `api/src/merchants/merchant-memory.service.ts`
- Test: `api/src/merchants/merchant-memory.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** Add them at the end of the outer `describe` block:

```ts
  describe('add', () => {
    it('remembers a merchant typed by hand and files its rows waiting for review', async () => {
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      const waiting = query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }, { _id: 't2', merchant: 'UBER *EATS' }]);
      txModel.find.mockReturnValue(waiting);
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await expect(service.add('UBER *TRIP', 'transport')).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 1 });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ userId: 1, key: 'uber trip' });
      expect(memoryModel.create).toHaveBeenCalledWith({ userId: 1, key: 'uber trip', category: 'transport', updatedAt: expect.any(Date) });
      expect(txModel.find).toHaveBeenCalledWith({ ...MERCHANT_ROWS, categoryNeedsReview: true });
      expect(txModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['t1'] }, categoryNeedsReview: true, deletedAt: null },
        { $set: { category: 'transport', categoryNeedsReview: false } },
      );
    });

    it.each([
      ['an over-long name', 'x'.repeat(201), 'transport'],
      ['a name that is not text', 42, 'transport'],
      ['a name with no usable key', '#123 4X2', 'transport'],
      ['a deleted category', 'UBER *TRIP', 'gym'],
      ['cash', 'UBER *TRIP', 'cash'],
      ['other', 'UBER *TRIP', 'other'],
      ['a missing category', 'UBER *TRIP', undefined],
    ])('refuses %s with 400 and remembers nothing', async (_label, name, category) => {
      await expect(service.add(name, category)).rejects.toBeInstanceOf(BadRequestException);
      expect(memoryModel.create).not.toHaveBeenCalled();
    });

    it('answers 409 when the merchant is already remembered, and changes nothing', async () => {
      memoryModel.findOne.mockReturnValue(query({ category: 'food' }));
      const err = await service.add('UBER *TRIP', 'transport').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Already remembered as food; change it in the list');
      expect(memoryModel.create).not.toHaveBeenCalled();
      expect(txModel.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 when a simultaneous add won the unique index', async () => {
      memoryModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      await expect(service.add('UBER *TRIP', 'transport')).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes any other database failure on', async () => {
      const failure = new Error('db down');
      memoryModel.create.mockRejectedValue(failure);
      await expect(service.add('UBER *TRIP', 'transport')).rejects.toBe(failure);
    });

    it('still answers when filing the waiting rows fails: logged, 0 filed', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }]));
      txModel.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.add('UBER *TRIP', 'transport')).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts -t "add"`
Expected: FAIL, `service.add is not a function`.

- [ ] **Step 3: Implement.** In `merchant-memory.service.ts`, change the first import to:

```ts
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
```

Add this public method after `match()`:

```ts
  /** Remembers a merchant typed by hand, then files its rows waiting for review. */
  async add(name: unknown, category: unknown): Promise<{ id: string; key: string; alsoFiled: number }> {
    if (typeof name !== 'string' || name.length > MAX_NAME) {
      throw new BadRequestException(`name must be text of at most ${MAX_NAME} characters`);
    }
    const key = merchantKey(name);
    if (!key) throw new BadRequestException("That name can't identify a merchant");
    const chosen = await this.assertUsable(category);
    const existing = await this.memoryModel.findOne({ userId: this.userId, key }).lean();
    // Adding never moves history: an existing merchant is changed from its row in the list.
    if (existing) throw new ConflictException(`Already remembered as ${existing.category}; change it in the list`);
    let created: { _id: unknown };
    try {
      created = await this.memoryModel.create({ userId: this.userId, key, category: chosen, updatedAt: new Date() });
    } catch (err) {
      // Two adds of the same name at once: the unique index on { userId, key } lets only one in.
      if ((err as { code?: number } | null)?.code === 11000) {
        throw new ConflictException('Already remembered; change it in the list');
      }
      throw err;
    }
    let alsoFiled = 0;
    try {
      alsoFiled = await this.fileWaiting(key, chosen);
    } catch (err) {
      // The merchant is remembered; its waiting rows are filed by the next ✓ on one of them.
      this.logger.error(`Could not file waiting rows for "${key}"`, err instanceof Error ? err.stack : String(err));
    }
    return { id: String(created._id), key, alsoFiled };
  }
```

Add this private method after `usableCategories()`:

```ts
  /** 400 unless `category` is an active category other than cash or other; returns it. */
  private async assertUsable(category: unknown): Promise<string> {
    if (typeof category !== 'string' || !category) throw new BadRequestException('category is required');
    if (NEVER_REMEMBERED.includes(category)) throw new BadRequestException('Cash and Other are never remembered');
    if (!(await this.usableCategories()).has(category)) throw new BadRequestException(`unknown category: ${category}`);
    return category;
  }
```

- [ ] **Step 4: Run the spec file.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/merchants/merchant-memory.service.ts api/src/merchants/merchant-memory.service.spec.ts
git commit -m "feat(api): add a merchant by hand; its waiting rows are filed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `change()` and `forget()`

**Files:**
- Modify: `api/src/merchants/merchant-memory.service.ts`
- Test: `api/src/merchants/merchant-memory.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** Add them at the end of the outer `describe` block:

```ts
  describe('change', () => {
    const ID = '64b000000000000000000001';

    beforeEach(() => {
      memoryModel.findOne.mockReturnValue(query({ _id: ID, key: 'prime video', category: 'food' }));
      memoryModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    });

    it("moves the merchant's rows still in the old category and its waiting rows, then the memory", async () => {
      const rows = query([
        { _id: 't1', merchant: 'PRIME VIDEO*2K3JD' },
        { _id: 't2', merchant: 'SOME STORE' },
        { _id: 't3', transactionName: 'prime video' },
      ]);
      txModel.find.mockReturnValue(rows);
      txModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
      await expect(service.change(ID, 'entertainment')).resolves.toEqual({ moved: 2 });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ _id: ID, userId: 1 });
      expect(txModel.find).toHaveBeenCalledWith({ ...MERCHANT_ROWS, $or: [{ category: 'food' }, { categoryNeedsReview: true }] });
      expect(txModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['t1', 't3'] }, deletedAt: null, $or: [{ category: 'food' }, { categoryNeedsReview: true }] },
        { $set: { category: 'entertainment', categoryNeedsReview: false } },
      );
      expect(memoryModel.updateOne).toHaveBeenCalledWith(
        { _id: ID, userId: 1, category: 'food' },
        { $set: { category: 'entertainment', updatedAt: expect.any(Date) } },
      );
    });

    it('moves the rows before it updates the memory, so a retry after a failure is safe', async () => {
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'PRIME VIDEO*2K3JD' }]));
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await service.change(ID, 'entertainment');
      expect(txModel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(memoryModel.updateOne.mock.invocationCallOrder[0]);
    });

    it('updates only the memory when no row needs moving', async () => {
      await expect(service.change(ID, 'entertainment')).resolves.toEqual({ moved: 0 });
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).toHaveBeenCalled();
    });

    it('answers 409 when something changed the memory in between', async () => {
      memoryModel.updateOne.mockResolvedValue({ matchedCount: 0 });
      await expect(service.change(ID, 'entertainment')).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes nothing when the category is the same', async () => {
      await expect(service.change(ID, 'food')).resolves.toEqual({ moved: 0 });
      expect(txModel.find).not.toHaveBeenCalled();
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).not.toHaveBeenCalled();
    });

    it.each([['gym'], ['cash'], ['other'], [undefined]])('refuses %s with 400 and writes nothing', async (category) => {
      await expect(service.change(ID, category)).rejects.toBeInstanceOf(BadRequestException);
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a merchant no longer remembered', async () => {
      memoryModel.findOne.mockReturnValue(query(null));
      await expect(service.change(ID, 'entertainment')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 for a malformed id without querying', async () => {
      await expect(service.change('nope', 'entertainment')).rejects.toBeInstanceOf(NotFoundException);
      expect(memoryModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('forget', () => {
    const ID = '64b000000000000000000001';

    it('removes the memory and leaves every row alone', async () => {
      await expect(service.forget(ID)).resolves.toBeUndefined();
      expect(memoryModel.deleteOne).toHaveBeenCalledWith({ _id: ID, userId: 1 });
      expect(txModel.updateMany).not.toHaveBeenCalled();
    });

    it('is quiet when the merchant is already gone', async () => {
      memoryModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      await expect(service.forget(ID)).resolves.toBeUndefined();
    });

    it('is quiet for a malformed id, without querying', async () => {
      await expect(service.forget('nope')).resolves.toBeUndefined();
      expect(memoryModel.deleteOne).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts -t "change|forget"`
Expected: FAIL, `service.change is not a function` and `service.forget is not a function`.

- [ ] **Step 3: Implement.** In `merchant-memory.service.ts`, change the first two imports to:

```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
```

Add these public methods after `add()`:

```ts
  /**
   * Changes a merchant's category. Its rows still in the old category, and its
   * rows waiting for review, move first; the memory follows only if nothing
   * changed it in between (else 409). If the memory update fails, a retry is
   * safe: the moved rows are no longer in the old category.
   */
  async change(id: string, category: unknown): Promise<{ moved: number }> {
    const chosen = await this.assertUsable(category);
    const entry = Types.ObjectId.isValid(id)
      ? await this.memoryModel.findOne({ _id: id, userId: this.userId }).lean()
      : null;
    if (!entry) throw new NotFoundException('That merchant is no longer remembered');
    const old = entry.category;
    if (old === chosen) return { moved: 0 };
    const stillOld = { $or: [{ category: old }, { categoryNeedsReview: true }] };
    const ids = (await this.merchantRows(stillOld)).filter((t) => keyOf(t) === entry.key).map((t) => t._id);
    let moved = 0;
    if (ids.length > 0) {
      const res = await this.txModel.updateMany(
        { _id: { $in: ids }, ...NOT_DELETED, ...stillOld },
        { $set: { category: chosen, categoryNeedsReview: false } },
      );
      moved = res.modifiedCount;
    }
    const res = await this.memoryModel.updateOne(
      { _id: entry._id, userId: this.userId, category: old },
      { $set: { category: chosen, updatedAt: new Date() } },
    );
    if (res.matchedCount === 0) throw new ConflictException('This merchant changed at the same time; reload and try again');
    return { moved };
  }

  /** Forgets a merchant. Its booked rows stay as they are; its next mail goes back to the AI with review. */
  async forget(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.memoryModel.deleteOne({ _id: id, userId: this.userId });
  }
```

- [ ] **Step 4: Run the spec file.**

Run: `cd api && npx jest src/merchants/merchant-memory.service.spec.ts`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/merchants/merchant-memory.service.ts api/src/merchants/merchant-memory.service.spec.ts
git commit -m "feat(api): change a merchant (its rows in the old category follow) or forget it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `MerchantsController`, module wiring and guard pin

**Files:**
- Create: `api/src/merchants/merchants.controller.ts`
- Create: `api/src/merchants/merchants.controller.spec.ts`
- Modify: `api/src/merchants/merchants.module.ts`
- Modify: `api/src/transactions/transactions.controller.spec.ts`

- [ ] **Step 1: Write the failing tests.** Create `api/src/merchants/merchants.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MerchantsController } from './merchants.controller';
import { MerchantsModule } from './merchants.module';

describe('MerchantsController', () => {
  const memory = { list: jest.fn(), match: jest.fn(), add: jest.fn(), change: jest.fn(), forget: jest.fn() };
  const controller = new MerchantsController(memory as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['add', 201],
    ['change', 200],
    ['forget', 204],
  ])('pins %s to %i', (method, code) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, (MerchantsController.prototype as any)[method])).toBe(code);
  });

  it('lists the remembered merchants', async () => {
    const rows = [{ id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: null, rows: 2, usable: true }];
    memory.list.mockResolvedValue(rows);
    await expect(controller.list()).resolves.toBe(rows);
  });

  it('passes the typed name to match', async () => {
    memory.match.mockResolvedValue({ key: 'uber trip', rows: 1, remembered: null });
    await expect(controller.match('UBER *TRIP')).resolves.toEqual({ key: 'uber trip', rows: 1, remembered: null });
    expect(memory.match).toHaveBeenCalledWith('UBER *TRIP');
  });

  it('passes the name and category to add', async () => {
    memory.add.mockResolvedValue({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
    await expect(controller.add({ name: 'UBER *TRIP', category: 'transport' })).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
    expect(memory.add).toHaveBeenCalledWith('UBER *TRIP', 'transport');
  });

  it('passes nothing on from a missing body, so the service answers 400', async () => {
    await controller.add(undefined);
    expect(memory.add).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes the id and category to change', async () => {
    memory.change.mockResolvedValue({ moved: 3 });
    await expect(controller.change('m1', { category: 'food' })).resolves.toEqual({ moved: 3 });
    expect(memory.change).toHaveBeenCalledWith('m1', 'food');
  });

  it('forgets and answers nothing', async () => {
    memory.forget.mockResolvedValue(undefined);
    await expect(controller.forget('m1')).resolves.toBeUndefined();
    expect(memory.forget).toHaveBeenCalledWith('m1');
  });
});

// Nest resolves providers only when the app starts; a missing module import would crash the pod on deploy.
// This compiles the real module graph (models stubbed, no database) so the tests catch it instead.
describe('MerchantsModule', () => {
  it('builds its controller with every dependency it needs', async () => {
    let builder = Test.createTestingModule({ imports: [MerchantsModule] });
    for (const model of ['MerchantCategory', 'Transaction', 'CustomCategory', 'Recurring', 'Budget', 'CashAllocation']) {
      builder = builder.overrideProvider(getModelToken(model)).useValue({});
    }
    const mod = await builder.compile();
    expect(mod.get(MerchantsController)).toBeInstanceOf(MerchantsController);
  });
});
```

In `api/src/transactions/transactions.controller.spec.ts`, add this import after the `CalculatorController` import:

```ts
import { MerchantsController } from '../merchants/merchants.controller';
```

Then add this entry after `['CalculatorController', CalculatorController],` in the `describe.each` list:

```ts
  ['MerchantsController', MerchantsController],
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/merchants/merchants.controller.spec.ts src/transactions/transactions.controller.spec.ts`
Expected: FAIL, `Cannot find module './merchants.controller'`.

- [ ] **Step 3: Implement.** Create `api/src/merchants/merchants.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MerchantMemoryService } from './merchant-memory.service';

interface AddMerchantBody {
  name?: unknown;
  category?: unknown;
}

interface ChangeMerchantBody {
  category?: unknown;
}

/** The Merchants page: see, add, change and forget the merchants the app files on its own. */
@Controller('merchants')
@UseGuards(JwtAuthGuard)
export class MerchantsController {
  constructor(private readonly memory: MerchantMemoryService) {}

  @Get()
  list() {
    return this.memory.list();
  }

  @Get('match')
  match(@Query('name') name?: unknown) {
    return this.memory.match(name);
  }

  @Post()
  @HttpCode(201)
  add(@Body() body?: AddMerchantBody) {
    return this.memory.add(body?.name, body?.category);
  }

  @Patch(':id')
  @HttpCode(200)
  change(@Param('id') id: string, @Body() body?: ChangeMerchantBody) {
    return this.memory.change(id, body?.category);
  }

  @Delete(':id')
  @HttpCode(204)
  async forget(@Param('id') id: string): Promise<void> {
    await this.memory.forget(id);
  }
}
```

In `api/src/merchants/merchants.module.ts`, add `import { MerchantsController } from './merchants.controller';` and the line `controllers: [MerchantsController],` just above `providers:`.

- [ ] **Step 4: Run the tests, the whole suite and the type check.**

Run: `cd api && npx jest src/merchants src/transactions/transactions.controller.spec.ts && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: all tests pass (64 suites), and `tsc` prints nothing.

- [ ] **Step 5: Commit.**

```bash
git add api/src/merchants api/src/transactions/transactions.controller.spec.ts
git commit -m "feat(api): /merchants routes behind the auth guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web api client, `CategoryService.loaded` and the deleted-guess review cell

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`
- Modify: `web/src/app/core/services/category.service.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.html`

The web has no test runner. It's verified with a clean build here, and by the controller's preview screenshots after Task 7.

- [ ] **Step 1: Add the models.** Append to `web/src/app/core/services/api.models.ts`:

```ts
// ── Merchants ──────────────────────────────────────────────────────────
export interface RememberedMerchant {
  id: string;
  key: string;
  category: string;
  /** ISO date of the last choice, or null for an entry saved before dates were kept. */
  updatedAt: string | null;
  /** Booked bank-mail rows from this merchant. */
  rows: number;
  /** False when its category was deleted, or is cash or other; ingestion then ignores it. */
  usable: boolean;
}

export interface MerchantMatch {
  /** Empty when the name can't identify a merchant. */
  key: string;
  rows: number;
  remembered: string | null;
}
```

- [ ] **Step 2: Add the api calls.** In `web/src/app/core/services/api.service.ts`, add `MerchantMatch,` after `IngestionStatusView,` and `RememberedMerchant,` after `RecurringEntry,` in the models import list. Then add these methods at the end of the class, after `getMyNumbers()`:

```ts
  getMerchants(): Observable<RememberedMerchant[]> {
    return this.http.get<RememberedMerchant[]>(`${this.base}/merchants`);
  }

  matchMerchant(name: string): Observable<MerchantMatch> {
    return this.http.get<MerchantMatch>(`${this.base}/merchants/match`, { params: new HttpParams().set('name', name) });
  }

  addMerchant(name: string, category: string): Observable<{ id: string; key: string; alsoFiled: number }> {
    return this.http.post<{ id: string; key: string; alsoFiled: number }>(`${this.base}/merchants`, { name, category });
  }

  changeMerchant(id: string, category: string): Observable<{ moved: number }> {
    return this.http.patch<{ moved: number }>(`${this.base}/merchants/${id}`, { category });
  }

  forgetMerchant(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/merchants/${id}`);
  }
```

- [ ] **Step 3: Add `CategoryService.loaded`.** In `web/src/app/core/services/category.service.ts`, add this field after `private customMap … = {};`:

```ts
  /** True once the category list has arrived; before that, custom categories are missing from `all`. */
  loaded = false;
```

In `load()`, add `this.loaded = true;` as the last line of the `next` callback, after the `this._all = [...]` assignment.

- [ ] **Step 4: Recognize a deleted guess on the Transactions page.** In `web/src/app/pages/transactions/transactions.component.ts`, add this method right above `assignCategory(`:

```ts
  /** A guess naming a category deleted since: it can't be confirmed, only replaced. Unknown until the list has loaded. */
  isDeletedGuess(category: string): boolean {
    return this.catSvc.loaded && !this.categories.includes(category);
  }
```

In `assignCategory`, replace this line:

```ts
        if (next) setTimeout(() => document.getElementById(`confirm-${next._id}`)?.focus(), 0);
```

with this, because a row with a deleted guess has no ✓, so its picker takes the focus instead:

```ts
        if (next) {
          setTimeout(() => (document.getElementById(`confirm-${next._id}`) ?? document.getElementById(`pick-${next._id}`))?.focus(), 0);
        }
```

- [ ] **Step 5: Update the review cell.** In `web/src/app/pages/transactions/transactions.component.html`, replace the whole `<div class="review-cell"> … </div>` block (from `<div class="review-cell">` through its closing `</div>`, just before `} @else {`) with:

```html
              <div class="review-cell">
                <span class="cat-pill guess-pill"
                      [style.background]="catColor(tx.category) + '22'"
                      [style.color]="catColor(tx.category)">
                  <span class="dot" [style.background]="catColor(tx.category)"></span>
                  {{ tx.category | titlecase }}?{{ isDeletedGuess(tx.category) ? ' (deleted)' : '' }}
                </span>
                @if (!isDeletedGuess(tx.category)) {
                  <button [id]="'confirm-' + tx._id" type="button" class="icon-act confirm-guess"
                          [disabled]="reviewing.has(tx._id)"
                          [attr.aria-label]="'Confirm ' + (tx.category | titlecase) + ' for ' + tx.transactionName"
                          (click)="assignCategory(tx, tx.category)">
                    <mat-icon>check</mat-icon>
                  </button>
                }
                <select [id]="'pick-' + tx._id" class="review-select"
                        [attr.aria-label]="'Category for ' + tx.transactionName"
                        [disabled]="reviewing.has(tx._id)"
                        (change)="assignCategory(tx, $any($event.target).value, $any($event.target))">
                  @if (isDeletedGuess(tx.category)) {
                    <option value="" disabled selected>Choose a category</option>
                  }
                  @for (cat of categories; track cat) {
                    <option [value]="cat" [selected]="cat === tx.category">{{ cat | titlecase }}</option>
                  }
                </select>
              </div>
```

A failed change already sets `select.value = tx.category`. For a deleted guess that value matches no option, so the picker falls back to "Choose a category", which is the intended state.

- [ ] **Step 6: Build.**

Run: `cd web && npx ng build`
Expected: "Application bundle generation complete." with no errors. Budget warnings that already appeared before this change are fine.

- [ ] **Step 7: Commit.**

```bash
git add web/src/app/core/services web/src/app/pages/transactions
git commit -m "feat(web): merchant api calls; a guess naming a deleted category can only be replaced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Merchants page, route and sidebar item

**Files:**
- Create: `web/src/app/pages/merchants/merchants.component.ts`
- Create: `web/src/app/pages/merchants/merchants.component.html`
- Create: `web/src/app/pages/merchants/merchants.component.scss`
- Modify: `web/src/app/app.routes.ts`
- Modify: `web/src/app/app.component.ts`

This page follows the Categories page (`web/src/app/pages/categories/`). Read `categories.component.ts` first: its `mode`, `busy`, `gen`, `focus`, `restoreFocus` and `message` helpers are reused here in the same shape. The global styles provide `.card`, `.page-wrap`, `.cat-pill` with `.dot`, and `.fc-field`, `.fc-input`, `.fc-btn`, `.fc-btn--primary`, `.fc-btn--ghost` and `.fc-error`. The page's own stylesheet uses theme tokens only.

- [ ] **Step 1: Create the component logic.** `web/src/app/pages/merchants/merchants.component.ts`:

```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Observable, Subject, Subscription, catchError, debounceTime, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { CategoryService } from '../../core/services/category.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
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

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

@Component({
  selector: 'app-merchants',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './merchants.component.html',
  styleUrls: ['./merchants.component.scss'],
})
export class MerchantsComponent implements OnInit, OnDestroy {
  merchants: RememberedMerchant[] = [];
  /** What a merchant can be remembered under: the active categories without cash and other. */
  categories: string[] = [];
  loading = true;
  loadError = '';
  status = '';
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
    return f ? this.merchants.filter((m) => m.key.includes(f)) : this.merchants;
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
    );
  }

  saveChange(m: RememberedMerchant): void {
    const category = this.category;
    if (this.busy || !category || category === m.category) return;
    this.run(
      this.api.changeMerchant(m.id, category),
      (r) => (r.moved > 0 ? `Moved ${plural(r.moved, `${m.key} row`, `${m.key} rows`)} to ${title(category)}` : 'Saved'),
      [`change-${m.id}`, 'add-merchant'],
    );
  }

  forget(m: RememberedMerchant): void {
    if (this.busy) return;
    const list = this.shown;
    const i = list.findIndex((x) => x.id === m.id);
    const next = list[i + 1] ?? list[i - 1];
    this.run(
      this.api.forgetMerchant(m.id),
      () => `Forgot ${m.key}`,
      next ? [`change-${next.id}`, 'add-merchant'] : ['add-merchant'],
    );
  }

  private open(mode: Mode, focusId: string): void {
    this.mode = mode;
    this.actionError = '';
    this.status = '';
    this.formFocus = focusId;
    this.focus(focusId);
  }

  private run<T>(request: Observable<T>, done: (reply: T) => string, focusIds: string[]): void {
    this.busy = true;
    this.actionError = '';
    this.subs.add(
      request.subscribe({
        next: (reply) => {
          this.busy = false;
          this.mode = { kind: 'none' };
          this.status = done(reply);
          this.focusAfterLoad = focusIds;
          this.events.notify(); // rows may have moved: every list reloads, this page included (changed$)
          this.focus(...focusIds);
        },
        error: (e: HttpErrorResponse) => {
          this.busy = false;
          this.actionError = this.message(e, 'Something went wrong. Please try again.');
          this.load(); // a 404 or 409 means this list is stale
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
          // The merchant being changed or forgotten may be gone (another tab forgot it).
          const m = this.mode;
          if ((m.kind === 'change' || m.kind === 'forget') && !this.busy && !merchants.some((x) => x.id === m.id)) {
            this.mode = { kind: 'none' };
            this.actionError = '';
            this.status = 'That merchant was changed in another tab.';
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
```

- [ ] **Step 2: Create the template.** `web/src/app/pages/merchants/merchants.component.html`:

```html
<div class="page-wrap">
  <div class="mer-header">
    <div>
      <h1>Merchants</h1>
      <p class="mer-muted">Bank merchants the app files on its own. Change one and its rows in the old category follow.</p>
    </div>
    <button
      id="add-merchant"
      type="button"
      class="fc-btn fc-btn--primary"
      [disabled]="loading || !!loadError || busy || mode.kind !== 'none'"
      (click)="openAdd()"
    >
      <mat-icon>add</mat-icon> Add merchant
    </button>
  </div>

  <p class="mer-status" aria-live="polite">{{ status }}</p>

  @if (loading) {
    <p class="mer-muted">Loading…</p>
  } @else if (loadError) {
    <p class="fc-error" role="alert">{{ loadError }}</p>
  } @else {
    @if (mode.kind === 'add') {
      <section class="card mer-section" aria-labelledby="mer-add-title">
        <h2 id="mer-add-title">Add merchant</h2>
        <form class="mer-form" (ngSubmit)="add()">
          <label class="fc-field">
            <span>Name as the bank writes it</span>
            <input
              id="merchant-name"
              class="fc-input"
              type="text"
              maxlength="200"
              autocomplete="off"
              [ngModel]="name"
              (ngModelChange)="onName($event)"
              name="name"
            />
          </label>
          <p class="mer-hint" aria-live="polite">{{ previewText }}</p>
          <label class="fc-field">
            <span>Category</span>
            <select class="fc-input" [(ngModel)]="category" name="category">
              <option value="" disabled>Choose a category</option>
              @for (c of categories; track c) {
                <option [value]="c">{{ c | titlecase }}</option>
              }
            </select>
          </label>
          @if (actionError) {
            <p class="fc-error" role="alert">{{ actionError }}</p>
          }
          <div class="mer-actions">
            <button type="button" class="fc-btn fc-btn--ghost" [disabled]="busy" (click)="close()">Cancel</button>
            <button type="submit" class="fc-btn fc-btn--primary" [disabled]="!canAdd">{{ busy ? 'Saving…' : 'Add' }}</button>
          </div>
        </form>
      </section>
    }

    <section class="card mer-section" aria-labelledby="mer-list-title">
      <h2 id="mer-list-title">Remembered</h2>
      @if (merchants.length === 0) {
        <p class="mer-muted">Nothing remembered yet. Confirm a category on the Transactions page and the merchant shows up here.</p>
      } @else {
        <label class="fc-field mer-filter">
          <span>Filter</span>
          <input class="fc-input" type="search" autocomplete="off" [(ngModel)]="filter" name="filter" />
        </label>
        @if (shown.length === 0) {
          <p class="mer-muted">No merchants match "{{ filter.trim() }}".</p>
        }
        <ul class="mer-list">
          @for (m of shown; track m.id) {
            <li class="mer-row">
              <div class="mer-main">
                <span class="mer-key">{{ m.key }}</span>
                @if (m.usable) {
                  <span class="cat-pill"
                        [style.background]="catColor(m.category) + '22'"
                        [style.color]="catColor(m.category)">
                    <span class="dot" [style.background]="catColor(m.category)"></span>
                    {{ m.category | titlecase }}
                  </span>
                } @else {
                  <span class="mer-warning">{{ notUsedText(m) }}</span>
                }
              </div>
              <span class="mer-usage">{{ usageText(m) }}</span>

              @if (mode.kind === 'change' && mode.id === m.id) {
                <form class="mer-inline" (ngSubmit)="saveChange(m)">
                  <label class="fc-field">
                    <span>New category for {{ m.key }}</span>
                    <select [id]="'pick-' + m.id" class="fc-input" [(ngModel)]="category" name="category">
                      <option value="" disabled>Choose a category</option>
                      @for (c of categories; track c) {
                        <option [value]="c">{{ c | titlecase }}</option>
                      }
                    </select>
                  </label>
                  @if (actionError) {
                    <p class="fc-error" role="alert">{{ actionError }}</p>
                  }
                  <div class="mer-actions">
                    <button type="button" class="fc-btn fc-btn--ghost" [disabled]="busy" (click)="close()">Cancel</button>
                    <button type="submit" class="fc-btn fc-btn--primary" [disabled]="busy || !category || category === m.category">
                      {{ busy ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </form>
              } @else if (mode.kind === 'forget' && mode.id === m.id) {
                <div class="mer-inline">
                  <p>Forget {{ m.key }}? New mail from it goes back to review.</p>
                  @if (actionError) {
                    <p class="fc-error" role="alert">{{ actionError }}</p>
                  }
                  <div class="mer-actions">
                    <button type="button" class="fc-btn fc-btn--ghost" [disabled]="busy" (click)="close()">Cancel</button>
                    <button [id]="'confirm-forget-' + m.id" type="button" class="fc-btn mer-danger" [disabled]="busy" (click)="forget(m)">
                      {{ busy ? 'Forgetting…' : 'Forget' }}
                    </button>
                  </div>
                </div>
              } @else {
                <div class="mer-row-actions">
                  <button
                    [id]="'change-' + m.id"
                    type="button"
                    class="fc-btn fc-btn--ghost"
                    [disabled]="busy || mode.kind !== 'none'"
                    [attr.aria-label]="'Change category for ' + m.key"
                    (click)="openChange(m)"
                  >
                    Change
                  </button>
                  <button
                    [id]="'forget-' + m.id"
                    type="button"
                    class="fc-btn fc-btn--ghost"
                    [disabled]="busy || mode.kind !== 'none'"
                    [attr.aria-label]="'Forget ' + m.key"
                    (click)="openForget(m)"
                  >
                    Forget
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  }
</div>
```

- [ ] **Step 3: Create the stylesheet.** `web/src/app/pages/merchants/merchants.component.scss` uses theme tokens only:

```scss
.mer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);

  h1 {
    margin: 0;
    font-size: var(--text-page-title);
  }
}

.mer-muted,
.mer-hint {
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.mer-hint:empty {
  display: none;
}

.mer-status {
  margin: 0 0 var(--space-sm);
  min-height: 1em;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.mer-section {
  margin-bottom: var(--space-lg);

  h2 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-lg);
  }
}

.mer-form .fc-field + .fc-field,
.mer-hint + .fc-field {
  margin-top: var(--space-sm);
}

.mer-filter {
  max-width: 20rem;
  margin-bottom: var(--space-sm);
}

.mer-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mer-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-sm);
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--border);

  &:first-child {
    border-top: none;
  }

  // A phone stacks each merchant: its name and pill, then its counts, then its actions.
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
  }
}

.mer-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
  flex: 1 1 16rem;
  min-width: 0;

  @media (max-width: 640px) {
    flex-basis: auto;
  }
}

.mer-key {
  color: var(--text);
  overflow-wrap: anywhere;
}

.mer-usage {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mer-warning {
  font-size: var(--text-sm);
  color: var(--color-warning);
}

.mer-row-actions,
.mer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.mer-actions {
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.mer-inline {
  flex: 1 1 100%;
  align-self: stretch;

  p:not(.fc-error) {
    margin: 0 0 var(--space-xs);
    color: var(--text);
  }
}

.mer-danger {
  background: var(--expense);
  border-color: var(--expense);
  color: var(--color-accent-ink);

  &:hover:not(:disabled) {
    opacity: 0.85;
  }
}
```

- [ ] **Step 4: Add the route and the sidebar item.** In `web/src/app/app.routes.ts`, add this route after the `categories` route (inside the array, before the closing `];`):

```ts
  {
    path: 'merchants',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/merchants/merchants.component').then((m) => m.MerchantsComponent),
  },
```

In `web/src/app/app.component.ts`, add this nav item right after the `Categories` line:

```ts
    { label: 'Merchants',    icon: 'storefront',             path: '/merchants' },
```

- [ ] **Step 5: Build, and check for colour literals.**

Run: `cd web && npx ng build && grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(" src/app/pages/merchants/merchants.component.scss`
Expected: the build completes with no errors, and the grep prints nothing (it exits 1).

- [ ] **Step 6: Commit.**

```bash
git add web/src/app/pages/merchants web/src/app/app.routes.ts web/src/app/app.component.ts
git commit -m "feat(web): Merchants page — see, change, forget and add remembered merchants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the feature row.** In `README.md`'s "Web Dashboard" table, add this row right after the `| **Merchant memory** | … |` row:

```markdown
| **Merchants** | Every bank merchant the app files on its own, with its booked rows: change its category (its rows still in the old category follow), forget it, or add one by hand with a live preview of what the name matches |
```

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "docs(readme): Merchants page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller checklist (after all tasks)

1. `cd api && npx jest` (all pass; note the counts) and `npx tsc --noEmit -p tsconfig.json`.
2. `cd web && npx ng build`.
3. Preview harness: a scratch copy of `web/` with a fake `ApiService`. Take screenshots of:
   - the list;
   - the add form's preview states;
   - a change, with its status line;
   - a forget confirmation;
   - a "Not used" row;
   - the phone width (375 px);
   - a Transactions row with a deleted guess.
4. Final review of the whole branch; fix anything it finds.
5. PII gate on the diff and on the commit messages.
6. Append "As built" and "Follow-ups" to this plan, update the memory file, push, watch CI, then give the user the `kubectl rollout restart` command.
