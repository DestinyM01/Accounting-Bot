# Categories Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Custom categories get a web page — validated create (reviving a deleted name), edit, cascading rename, and delete that moves every transaction, recurring rule and budget to a chosen category in re-runnable steps.

**Architecture:**
- **`category-rules.ts`** is pure: the name rule, reserved names, palette and emoji.
- **`CategoryReferencesService`** owns the three collections that name categories: usage counts, and the idempotent `migrate(from, to)` with the budget merge.
- **`CategoriesService`** owns the category records: create, update, remove, finish and overview. Every move begins with one guarded write that sets `pending`.
- **The web** gets a standalone Categories page.

**Tech Stack:** NestJS 10, Mongoose 8, Jest (api, **pnpm**); Mongoose 7 (repo mirror schema, **npm**); Angular 17 standalone (web, **pnpm**, no test runner).

**Spec:** `docs/superpowers/specs/2026-09-24-categories-page-design.md`

---

## Before you start — facts about this codebase

- **Categories are referenced by name** in `transactions.category`, `recurrings.category` and `budgets.category`. Budgets are keyed by `category + month + year`, with no unique index.
- **`NOT_DELETED`** = `{ deletedAt: null }`, from `api/src/shared/schemas/transfer-kind.ts`.
- **MongoDB here is a single node:** no multi-document transactions. Every step of a move must be safe to repeat, and each step's filter includes the old name.
- **`CategoriesService.list()` and `assertValid()` are used by other modules** (ingestion, transactions, recurring). Keep their behaviour exactly.
- **Query-string and body values are not validated by any pipe.** Validate in the service; throw `BadRequestException` (400), `ConflictException` (409) or `NotFoundException` (404) with a user-readable message, because the web shows the server's `message`.
- **`repo/` is the retired bot.** Its `custom-category.schema.ts` shares the collection, so the new field is mirrored there. Nothing else in `repo/` changes.
- **Web styles:**
  - shared classes `.fc-field`, `.fc-input`, `.fc-btn`, `.fc-btn--primary`, `.fc-btn--ghost`, `.fc-error`, and globals `.page-wrap` and `.card`;
  - page stylesheets use only `var(--…)` tokens;
  - swatch colours are *data* bound with `[style.background]`, never written in a stylesheet.
- **Public repository:** no real names, account numbers, email addresses or transaction ids anywhere.
- **Git:** `git add <explicit paths>` only — never `-A` or `.`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Do not push.** Ignore other git worktrees or branches.
- **Counts:** baseline **api 39 suites / 380 tests**, **repo 13 / 82**. If your baseline differs, the per-task deltas (listed by test name) must hold.
- Use `cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/<dir>"` in every command.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/categories/category-rules.ts` (+ spec) | create | pure rules, palette, emoji |
| `api/src/shared/schemas/custom-category.schema.ts` (+ new spec) | modify | + `pending` |
| `repo/src/mongodb/schemas/custom-category.schema.ts` (+ new spec) | modify | + `pending` (mirror) |
| `api/src/categories/category-references.service.ts` (+ spec) | create | `usage()`, `migrate(from, to)` |
| `api/src/categories/categories.service.ts` (+ rewritten spec) | modify | create/update/remove/finish/overview |
| `api/src/categories/categories.controller.ts` | modify | routes |
| `api/src/categories/categories.module.ts` | modify | models + provider |
| `api/src/transactions/transactions.controller.spec.ts` | modify | pin the guard on `CategoriesController` |
| `web/src/app/core/services/api.models.ts`, `api.service.ts` | modify | types and calls |
| `web/src/app/pages/categories/categories.component.{ts,html,scss}` | create | the page |
| `web/src/app/app.routes.ts`, `web/src/app/app.component.ts` | modify | route, nav item |
| `README.md` | modify | page and endpoints |

---

### Task 0: Baseline

- [ ] **Step 1**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/repo" && npm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git status --short
```

Expected: api `39 passed` / `380 passed`; repo `13` / `82`; web prints only `web-done`; clean tree.

---

### Task 1: `category-rules.ts`

**Files:** Create `api/src/categories/category-rules.ts`; Test `api/src/categories/category-rules.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/categories/category-rules.spec.ts`:

```ts
import { EMOJIS, PALETTE, isKnownEmoji, isPaletteColor, nameError, normalizeName } from './category-rules';

describe('category rules', () => {
  it.each(['gym', 'side-income', 'educación', 'niños', 'a', 'x'.repeat(20)])('accepts %s', (name) => {
    expect(nameError(name)).toBeNull();
  });

  it.each([
    ['a space', 'a b'],
    ['an empty name', ''],
    ['21 characters', 'x'.repeat(21)],
    ['punctuation', 'gym!'],
    ['uppercase', 'Gym'],
  ])('rejects %s', (_label, name) => {
    expect(nameError(name)).toMatch(/lowercase letters/);
  });

  it('reserves every built-in name', () => {
    for (const name of ['food', 'transport', 'housing', 'health', 'entertainment', 'salary', 'savings', 'other']) {
      expect(nameError(name)).toMatch(/built-in/);
    }
  });

  it('normalizes by trimming and lowercasing; anything but a string becomes empty', () => {
    expect(normalizeName('  Gym  ')).toBe('gym');
    expect(normalizeName(5)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('accepts only palette colours and the offered emoji', () => {
    expect(isPaletteColor('#3b82f6')).toBe(true);
    expect(isPaletteColor('#123456')).toBe(false);
    expect(isPaletteColor(undefined)).toBe(false);
    expect(isKnownEmoji('💪')).toBe(true);
    expect(isKnownEmoji('🦄')).toBe(false);
    expect(isKnownEmoji(7)).toBe(false);
  });

  it("keeps the bot's 10 colours and 20 emoji", () => {
    expect(PALETTE).toHaveLength(10);
    expect(EMOJIS).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-rules 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './category-rules'`.

- [ ] **Step 3: Implement**

Create `api/src/categories/category-rules.ts`:

```ts
import { Category } from '../shared/schemas/category.enum';

/** Names custom categories may never take. */
export const BUILT_IN_NAMES: readonly string[] = Object.values(Category);

/** The colours the bot offered, in its order. */
export const PALETTE: readonly { label: string; hex: string }[] = [
  { label: 'Red', hex: '#ef4444' },
  { label: 'Orange', hex: '#fb923c' },
  { label: 'Yellow', hex: '#eab308' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Purple', hex: '#a855f7' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Cyan', hex: '#06b6d4' },
  { label: 'Dark', hex: '#374151' },
  { label: 'Light', hex: '#94a3b8' },
];

/** The emoji the bot offered, in its order. */
export const EMOJIS: readonly string[] = [
  '✈️', '💪', '🏋️', '🎓', '🐶', '🐱', '🛒', '📱', '💇', '🎁',
  '⚡', '🌿', '🎨', '🎵', '🏖️', '🍕', '☕', '🛞', '📚', '🎯',
];

/** Lowercase letters of any alphabet (educación, niños), digits and hyphens; 1–20 characters. */
export const NAME_PATTERN = /^[\p{Ll}0-9-]{1,20}$/u;

export function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Why a (normalized) name can't be used, or null when it can. */
export function nameError(name: string): string | null {
  if (!NAME_PATTERN.test(name)) return 'Use 1–20 lowercase letters, digits or hyphens';
  if (BUILT_IN_NAMES.includes(name)) return `${name} is a built-in category`;
  return null;
}

export function isPaletteColor(hex: unknown): boolean {
  return PALETTE.some((p) => p.hex === hex);
}

export function isKnownEmoji(emoji: unknown): boolean {
  return typeof emoji === 'string' && EMOJIS.includes(emoji);
}
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-rules 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 15 passed in the file; api **40 suites / 395 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/categories/category-rules.ts api/src/categories/category-rules.spec.ts
git commit -F- <<'EOF'
feat(api): category rules — names, reserved built-ins, palette and emoji

The bot's rules, now enforced by the api: lowercase letters (accented ones
too), digits and hyphens, 1-20 characters, never a built-in name, a colour
from its palette of 10 and an emoji from its set of 20.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `pending` on both custom-category schemas

**Files:**
- Modify `api/src/shared/schemas/custom-category.schema.ts`; create `api/src/shared/schemas/custom-category.schema.spec.ts`.
- Modify `repo/src/mongodb/schemas/custom-category.schema.ts`; create `repo/src/mongodb/schemas/custom-category.schema.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/shared/schemas/custom-category.schema.spec.ts`:

```ts
import { CustomCategorySchema } from './custom-category.schema';

describe('CustomCategorySchema', () => {
  // A delete or rename records the move here until every reference has moved;
  // "no move in progress" must be null so guarded writes can filter on it.
  it('declares pending, defaulting to null', () => {
    const path: any = CustomCategorySchema.path('pending');
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });
});
```

Create `repo/src/mongodb/schemas/custom-category.schema.spec.ts`:

```ts
import { CustomCategorySchema } from './custom-category.schema';

describe('CustomCategorySchema (bot mirror)', () => {
  // Same collection as the api's schema; a field in one and not the other is a bug.
  it('declares pending, defaulting to null', () => {
    const path: any = CustomCategorySchema.path('pending');
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- custom-category.schema 2>&1 | tail -6
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/repo" && npm test -- custom-category.schema 2>&1 | tail -6
```

Expected: both FAIL on `expect(path).toBeDefined()`.

- [ ] **Step 3: Implement**

In `api/src/shared/schemas/custom-category.schema.ts`, add after the `active` property:

```ts
  /** An unfinished move of every reference from one name to another; cleared when it completes. */
  @Prop({ type: Object, default: null }) pending?: { from: string; to: string } | null;
```

In `repo/src/mongodb/schemas/custom-category.schema.ts`, add after the `active` property:

```ts
  /**
   * Mirror of api/src/shared/schemas/custom-category.schema.ts — same collection.
   * Written only by the api: an unfinished move of every reference from one
   * name to another; cleared when it completes.
   */
  @Prop({ type: Object, default: null })
  pending?: { from: string; to: string } | null;
```

- [ ] **Step 4: Run to verify, then the full suites**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/repo" && npm test 2>&1 | tail -5
```

Expected: api **41 suites / 396 tests**; repo **14 suites / 83 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/custom-category.schema.ts api/src/shared/schemas/custom-category.schema.spec.ts repo/src/mongodb/schemas/custom-category.schema.ts repo/src/mongodb/schemas/custom-category.schema.spec.ts
git commit -F- <<'EOF'
feat(api,bot): custom categories record an unfinished move

pending {from, to} is set by the first write of a delete or rename and
cleared once every reference has moved. Mirrored in the bot's schema —
same collection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `CategoryReferencesService` — usage and the move

**Files:** Create `api/src/categories/category-references.service.ts`; Test `api/src/categories/category-references.service.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/categories/category-references.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CategoryReferencesService } from './category-references.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Budget } from '../shared/schemas/budget.schema';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

describe('CategoryReferencesService', () => {
  let service: CategoryReferencesService;
  let txModel: { aggregate: jest.Mock; updateMany: jest.Mock };
  let recurringModel: { aggregate: jest.Mock; updateMany: jest.Mock };
  let budgetModel: { aggregate: jest.Mock; find: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock; findOneAndDelete: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { aggregate: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) };
    recurringModel = { aggregate: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) };
    budgetModel = {
      aggregate: jest.fn().mockResolvedValue([]),
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      updateOne: jest.fn().mockResolvedValue({}),
      findOneAndDelete: jest.fn(() => query(null)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CategoryReferencesService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: getModelToken(Budget.name), useValue: budgetModel },
      ],
    }).compile();
    service = mod.get(CategoryReferencesService);
  });

  it('counts live transactions, active rules and budgets per category', async () => {
    txModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 12 }, { _id: 'food', n: 4 }]);
    recurringModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 1 }]);
    budgetModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 2 }]);
    const usage = await service.usage();
    expect(usage.get('gym')).toEqual({ transactions: 12, recurring: 1, budgets: 2 });
    expect(usage.get('food')).toEqual({ transactions: 4, recurring: 0, budgets: 0 });
    expect(txModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, deletedAt: null } });
    expect(recurringModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, active: true } });
    expect(budgetModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1 } });
  });

  it('moves transactions and recurring rules by name, deleted and inactive ones included', async () => {
    await service.migrate('gym', 'health');
    expect(txModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
    expect(recurringModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
  });

  it('renames a budget when the target category has none that month', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    await service.migrate('gym', 'health');
    expect(budgetModel.findOne).toHaveBeenCalledWith({ userId: 1, category: 'health', month: 9, year: 2026 });
    expect(budgetModel.updateOne).toHaveBeenCalledWith({ _id: 'b1', category: 'gym' }, { $set: { category: 'health' } });
    expect(budgetModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  it("adds a budget into the target's for the same month, deleting it first", async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    budgetModel.findOne.mockReturnValue(query({ _id: 't1', limitAmount: 5000 }));
    budgetModel.findOneAndDelete.mockReturnValue(query({ _id: 'b1', limitAmount: 2000 }));
    await service.migrate('gym', 'health');
    expect(budgetModel.findOneAndDelete).toHaveBeenCalledWith({ _id: 'b1', category: 'gym' });
    expect(budgetModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $inc: { limitAmount: 2000 } });
    expect(budgetModel.findOneAndDelete.mock.invocationCallOrder[0]).toBeLessThan(
      budgetModel.updateOne.mock.invocationCallOrder[0],
    );
  });

  it('adds nothing when an earlier run already moved that budget', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    budgetModel.findOne.mockReturnValue(query({ _id: 't1', limitAmount: 7000 }));
    await service.migrate('gym', 'health'); // findOneAndDelete finds nothing
    expect(budgetModel.updateOne).not.toHaveBeenCalled();
  });

  it('only ever touches rows still under the old name', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    await service.migrate('gym', 'health');
    expect(budgetModel.find).toHaveBeenCalledWith({ userId: 1, category: 'gym' });
    for (const call of [...txModel.updateMany.mock.calls, ...recurringModel.updateMany.mock.calls, ...budgetModel.updateOne.mock.calls]) {
      expect(call[0]).toEqual(expect.objectContaining({ category: 'gym' }));
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-references 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './category-references.service'`.

- [ ] **Step 3: Implement**

Create `api/src/categories/category-references.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Budget } from '../shared/schemas/budget.schema';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';

export interface Usage {
  transactions: number;
  recurring: number;
  budgets: number;
}

export const NO_USAGE: Usage = { transactions: 0, recurring: 0, budgets: 0 };

/** The three collections that name categories: how much uses each name, and moving them all to another. */
@Injectable()
export class CategoryReferencesService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    @InjectModel(Budget.name) private readonly budgetModel: Model<Budget>,
  ) {}

  /** Live transactions, active recurring rules and budgets (any month) per category name. */
  async usage(): Promise<Map<string, Usage>> {
    const byCategory = [{ $group: { _id: '$category', n: { $sum: 1 } } }];
    const [tx, rules, budgets] = await Promise.all([
      this.txModel.aggregate([{ $match: { userId: this.userId, ...NOT_DELETED } }, ...byCategory]),
      this.recurringModel.aggregate([{ $match: { userId: this.userId, active: true } }, ...byCategory]),
      this.budgetModel.aggregate([{ $match: { userId: this.userId } }, ...byCategory]),
    ]);

    const usage = new Map<string, Usage>();
    const entry = (name: unknown): Usage => {
      const key = String(name);
      if (!usage.has(key)) usage.set(key, { ...NO_USAGE });
      return usage.get(key);
    };
    for (const r of tx) entry(r._id).transactions = r.n;
    for (const r of rules) entry(r._id).recurring = r.n;
    for (const r of budgets) entry(r._id).budgets = r.n;
    return usage;
  }

  /**
   * Moves every reference from one category name to another. Each step only
   * touches rows still under `from`, so re-running it — after it completed or
   * after it was interrupted — never changes anything already moved.
   */
  async migrate(from: string, to: string): Promise<void> {
    // Deleted transactions and inactive rules too: nothing may name a dead category.
    await this.txModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });
    await this.recurringModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });

    const budgets = await this.budgetModel.find({ userId: this.userId, category: from }).lean();
    for (const b of budgets) {
      const target = await this.budgetModel
        .findOne({ userId: this.userId, category: to, month: b.month, year: b.year })
        .lean();
      if (!target) {
        await this.budgetModel.updateOne({ _id: b._id, category: from }, { $set: { category: to } });
        continue;
      }
      // Delete first, then add: an interruption between the two under-counts
      // the budget (it warns early) rather than double-counting it.
      const moved = await this.budgetModel.findOneAndDelete({ _id: b._id, category: from }).lean();
      if (moved) await this.budgetModel.updateOne({ _id: target._id }, { $inc: { limitAmount: moved.limitAmount } });
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-references 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 6 passed; api **42 suites / 402 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/categories/category-references.service.ts api/src/categories/category-references.service.spec.ts
git commit -F- <<'EOF'
feat(api): count and move everything that names a category

usage() groups live transactions, active rules and budgets by category;
migrate(from, to) moves transactions (deleted ones too), recurring rules
(inactive too) and budgets, adding same-month budgets together. Every step
filters on the old name, so re-running it is harmless.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `CategoriesService`, controller and module

**Files:** Modify `api/src/categories/categories.service.ts`, `categories.controller.ts`, `categories.module.ts`; replace `api/src/categories/categories.service.spec.ts`; modify `api/src/transactions/transactions.controller.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `api/src/categories/categories.service.spec.ts` with (the four `assertValid` tests are kept unchanged):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryReferencesService } from './category-references.service';
import { CustomCategory } from '../shared/schemas/custom-category.schema';

const ID = '64b000000000000000000001';
const OLD_ID = '64b000000000000000000002';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { sort: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const gym = (overrides: Record<string, unknown> = {}) => ({
  _id: ID, userId: 1, name: 'gym', emoji: '💪', color: '#3b82f6', active: true, pending: null, ...overrides,
});

describe('CategoriesService', () => {
  let service: CategoriesService;
  let model: { find: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock; create: jest.Mock; updateOne: jest.Mock };
  let refs: { usage: jest.Mock; migrate: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    model = {
      // list(): the active custom categories. 'Gym' keeps the case-sensitivity test meaningful.
      find: jest.fn(() => query([{ _id: 'c1', name: 'Gym', color: '#000', emoji: 'x' }])),
      findOne: jest.fn(() => query(null)),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'new1' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    refs = { usage: jest.fn().mockResolvedValue(new Map()), migrate: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(CustomCategory.name), useValue: model },
        { provide: CategoryReferencesService, useValue: refs },
      ],
    }).compile();
    service = module.get(CategoriesService);
  });

  describe('assertValid', () => {
    it('passes for a built-in category', async () => {
      await expect(service.assertValid('food')).resolves.toBeUndefined();
    });

    it('passes for an active custom category', async () => {
      await expect(service.assertValid('Gym')).resolves.toBeUndefined();
    });

    it('rejects an unknown category', async () => {
      await expect(service.assertValid('nope')).rejects.toThrow(BadRequestException);
      await expect(service.assertValid('nope')).rejects.toThrow(/unknown category: nope/);
    });

    it('rejects the wrong case: names are stored verbatim', async () => {
      await expect(service.assertValid('gym')).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('normalizes the name and creates a new category', async () => {
      await expect(service.create({ name: '  Gym ', emoji: '💪', color: '#3b82f6' })).resolves.toEqual({ id: 'new1' });
      expect(model.create).toHaveBeenCalledWith({
        userId: 1, name: 'gym', emoji: '💪', color: '#3b82f6', active: true, pending: null,
      });
    });

    it('rejects a bad name, emoji or colour', async () => {
      await expect(service.create({ name: 'a b', emoji: '💪', color: '#3b82f6' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ name: 'gym', emoji: '🦄', color: '#3b82f6' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#123456' })).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a name you already have', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toThrow(
        /already have a category called gym/,
      );
    });

    it('rejects a name an unfinished move is still moving away from', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ active: false, pending: { from: 'gym', to: 'health' } })));
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toThrow(/still being moved/);
    });

    it('revives a deleted category instead of duplicating it', async () => {
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: OLD_ID });
      await expect(service.create({ name: 'gym', emoji: '🎯', color: '#ef4444' })).resolves.toEqual({ id: OLD_ID });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1, name: 'gym', active: false, pending: null },
        { $set: { active: true, emoji: '🎯', color: '#ef4444' } },
        { sort: { _id: -1 }, new: true },
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes emoji and colour in place, validating only what was sent', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ color: '#abcdef' }))); // a legacy colour, not sent
      await service.update(ID, { emoji: '🎯' });
      expect(model.updateOne).toHaveBeenCalledWith({ _id: ID, userId: 1 }, { $set: { emoji: '🎯' } });
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('answers 404 for a built-in or unknown id', async () => {
      await expect(service.update('food', { emoji: '🎯' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to edit a category mid-move', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ pending: { from: 'gym', to: 'fitness' } })));
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an invalid emoji, colour or name', async () => {
      model.findOne.mockReturnValue(query(gym()));
      await expect(service.update(ID, { emoji: '🦄' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(ID, { color: '#123456' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(ID, { name: 'a b' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('renames through one guarded write, then moves every reference and clears pending', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.update(ID, { name: ' Fitness ' });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, name: 'gym', active: true, pending: null },
        { $set: { name: 'fitness', pending: { from: 'gym', to: 'fitness' } } },
      );
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'fitness');
      expect(model.updateOne).toHaveBeenCalledWith({ _id: ID }, { $set: { pending: null } });
      expect(refs.migrate.mock.invocationCallOrder[0]).toBeLessThan(model.updateOne.mock.invocationCallOrder[0]);
    });

    it('refuses to rename onto a category that already exists', async () => {
      model.findOne
        .mockReturnValueOnce(query(gym()))
        .mockReturnValueOnce(query(gym({ _id: OLD_ID, name: 'fitness' })));
      await expect(service.update(ID, { name: 'fitness' })).rejects.toThrow(/delete gym and move it there/);
      expect(refs.migrate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('requires a category to move to while it is in use', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      refs.usage.mockResolvedValue(new Map([['gym', { transactions: 3, recurring: 0, budgets: 0 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects moving to itself or to a category that is not active', async () => {
      model.findOne.mockReturnValue(query(gym()));
      await expect(service.remove(ID, 'gym')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.remove(ID, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deactivates an unused category without moving anything', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.remove(ID);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, active: true, pending: null },
        { $set: { active: false, pending: null } },
      );
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('hides it first, then moves everything and clears pending', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      refs.usage.mockResolvedValue(new Map([['gym', { transactions: 3, recurring: 1, budgets: 2 }]]));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.remove(ID, 'health');
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, active: true, pending: null },
        { $set: { active: false, pending: { from: 'gym', to: 'health' } } },
      );
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'health');
      expect(model.updateOne).toHaveBeenCalledWith({ _id: ID }, { $set: { pending: null } });
      expect(model.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(refs.migrate.mock.invocationCallOrder[0]);
    });

    it('answers 409 when another change got there first', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.remove(ID, 'health')).rejects.toBeInstanceOf(ConflictException);
      expect(refs.migrate).not.toHaveBeenCalled();
    });
  });

  describe('finish', () => {
    it('re-runs an unfinished move', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ active: false, pending: { from: 'gym', to: 'health' } })));
      await expect(service.finish(ID)).resolves.toEqual({ id: ID });
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'health');
      expect(model.updateOne).toHaveBeenCalledWith({ _id: ID }, { $set: { pending: null } });
    });

    it('answers 404 when there is no unfinished move', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.finish(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('overview', () => {
    it('lists built-ins first, then custom by name, with usage, palette and emoji', async () => {
      const custom = query([
        gym(),
        { _id: OLD_ID, name: 'old', emoji: '🎯', color: '#ef4444', active: false, pending: { from: 'old', to: 'food' } },
      ]);
      model.find.mockReturnValueOnce(custom);
      refs.usage.mockResolvedValue(
        new Map([
          ['food', { transactions: 5, recurring: 0, budgets: 1 }],
          ['gym', { transactions: 3, recurring: 1, budgets: 0 }],
        ]),
      );
      const o = await service.overview();
      expect(model.find).toHaveBeenCalledWith({ userId: 1, $or: [{ active: true }, { pending: { $ne: null } }] });
      expect(custom.sort).toHaveBeenCalledWith({ name: 1 });
      expect(o.categories[0]).toEqual({
        id: null, name: 'food', emoji: '🍔', color: '#10e5a0', isBuiltIn: true, active: true,
        usage: { transactions: 5, recurring: 0, budgets: 1 }, pending: null,
      });
      expect(o.categories.slice(8)).toEqual([
        { id: ID, name: 'gym', emoji: '💪', color: '#3b82f6', isBuiltIn: false, active: true,
          usage: { transactions: 3, recurring: 1, budgets: 0 }, pending: null },
        { id: OLD_ID, name: 'old', emoji: '🎯', color: '#ef4444', isBuiltIn: false, active: false,
          usage: { transactions: 0, recurring: 0, budgets: 0 }, pending: { from: 'old', to: 'food' } },
      ]);
      expect(o.palette).toHaveLength(10);
      expect(o.emojis).toHaveLength(20);
    });
  });
});
```

In `api/src/transactions/transactions.controller.spec.ts`, add `import { CategoriesController } from '../categories/categories.controller';` and `['CategoriesController', CategoriesController],` to the `describe.each([...])` list.

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- categories.service transactions.controller 2>&1 | tail -10
```

Expected: `categories.service.spec.ts` fails to compile (`create` takes one object; `update`, `remove`, `finish` and `overview` don't exist). The new `CategoriesController` guard case passes already (the guard is on the class today) — a pin; note it.

- [ ] **Step 3: Implement the service**

Replace the whole of `api/src/categories/categories.service.ts` with:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CustomCategory } from '../shared/schemas/custom-category.schema';
import { CategoryReferencesService, NO_USAGE } from './category-references.service';
import { EMOJIS, PALETTE, isKnownEmoji, isPaletteColor, nameError, normalizeName } from './category-rules';

const BUILT_IN = [
  { name: 'food',          color: '#10e5a0', emoji: '🍔' },
  { name: 'transport',     color: '#fb923c', emoji: '🚗' },
  { name: 'housing',       color: '#38bdf8', emoji: '🏠' },
  { name: 'health',        color: '#a78bfa', emoji: '💊' },
  { name: 'entertainment', color: '#f472b6', emoji: '🎮' },
  { name: 'salary',        color: '#10e5a0', emoji: '💼' },
  { name: 'savings',       color: '#34d399', emoji: '💰' },
  { name: 'other',         color: '#94a3b8', emoji: '📦' },
];

export interface CategoryInput {
  name?: unknown;
  emoji?: unknown;
  color?: unknown;
}

type Pending = { from: string; to: string };

@Injectable()
export class CategoriesService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(CustomCategory.name) private readonly model: Model<CustomCategory>,
    private readonly refs: CategoryReferencesService,
  ) {}

  /** Built-ins plus active custom categories: what every picker offers. */
  async list() {
    const custom = await this.model.find({ userId: this.userId, active: true }).lean();
    return [
      ...BUILT_IN.map((c) => ({ ...c, isBuiltIn: true, id: null })),
      ...custom.map((c) => ({
        name:      c.name,
        color:     c.color,
        emoji:     c.emoji,
        isBuiltIn: false,
        id:        (c as any)._id.toString(),
      })),
    ];
  }

  /** Rejects a category that is neither built-in nor an active custom one. Exact, case-sensitive: names are stored verbatim. */
  async assertValid(category: string): Promise<void> {
    const allowed = (await this.list()).map((c) => c.name);
    if (!allowed.includes(category)) throw new BadRequestException(`unknown category: ${category}`);
  }

  /** Everything the Categories page shows: every category with its usage, and the options for new ones. */
  async overview() {
    const [custom, usage] = await Promise.all([
      this.model.find({ userId: this.userId, $or: [{ active: true }, { pending: { $ne: null } }] }).sort({ name: 1 }).lean(),
      this.refs.usage(),
    ]);
    const usageOf = (name: string) => ({ ...(usage.get(name) ?? NO_USAGE) });
    return {
      categories: [
        ...BUILT_IN.map((c) => ({
          id: null, name: c.name, emoji: c.emoji, color: c.color, isBuiltIn: true, active: true,
          usage: usageOf(c.name), pending: null,
        })),
        ...custom.map((c) => ({
          id: String(c._id), name: c.name, emoji: c.emoji, color: c.color, isBuiltIn: false, active: c.active,
          usage: usageOf(c.name), pending: c.pending ?? null,
        })),
      ],
      palette: PALETTE,
      emojis: EMOJIS,
    };
  }

  async create(input: CategoryInput): Promise<{ id: string }> {
    const name = normalizeName(input?.name);
    const invalid = nameError(name);
    if (invalid) throw new BadRequestException(invalid);
    if (!isKnownEmoji(input?.emoji)) throw new BadRequestException('Choose one of the offered emoji');
    if (!isPaletteColor(input?.color)) throw new BadRequestException('Choose one of the offered colours');
    await this.assertNameFree(name, `You already have a category called ${name}`);

    // A name deleted earlier comes back as the same record, never a duplicate.
    const revived = await this.model.findOneAndUpdate(
      { userId: this.userId, name, active: false, pending: null },
      { $set: { active: true, emoji: input.emoji, color: input.color } },
      { sort: { _id: -1 }, new: true },
    );
    if (revived) return { id: String(revived._id) };

    const created = await this.model.create({
      userId: this.userId, name, emoji: input.emoji, color: input.color, active: true, pending: null,
    });
    return { id: String(created._id) };
  }

  /** Emoji and colour change in place; a new name is a rename that every reference follows. */
  async update(id: string, input: CategoryInput): Promise<{ id: string }> {
    const cat = await this.findEditable(id);

    const set: Record<string, unknown> = {};
    if (input?.emoji !== undefined) {
      if (!isKnownEmoji(input.emoji)) throw new BadRequestException('Choose one of the offered emoji');
      set.emoji = input.emoji;
    }
    if (input?.color !== undefined) {
      if (!isPaletteColor(input.color)) throw new BadRequestException('Choose one of the offered colours');
      set.color = input.color;
    }

    const to = input?.name !== undefined ? normalizeName(input.name) : cat.name;
    if (to === cat.name) {
      if (Object.keys(set).length > 0) await this.model.updateOne({ _id: cat._id, userId: this.userId }, { $set: set });
      return { id: String(cat._id) };
    }

    const invalid = nameError(to);
    if (invalid) throw new BadRequestException(invalid);
    await this.assertNameFree(to, `${to} already exists — delete ${cat.name} and move it there to merge`);

    // The rename and the reservation of the old name are one write.
    const pending: Pending = { from: cat.name, to };
    const claimed = await this.model.findOneAndUpdate(
      { _id: cat._id, userId: this.userId, name: cat.name, active: true, pending: null },
      { $set: { ...set, name: to, pending } },
    );
    if (!claimed) throw new ConflictException(`${cat.name} changed meanwhile — reload and try again`);
    await this.completeMove(cat._id, pending);
    return { id: String(cat._id) };
  }

  /** Deletes a custom category, moving everything that uses it to `moveTo` (required while it is in use). */
  async remove(id: string, moveTo?: string): Promise<void> {
    const cat = await this.findEditable(id);
    const usage = (await this.refs.usage()).get(cat.name) ?? NO_USAGE;
    const inUse = usage.transactions + usage.recurring + usage.budgets > 0;

    let pending: Pending | null = null;
    if (moveTo) {
      if (moveTo === cat.name) throw new BadRequestException('Choose a different category to move it to');
      const active = (await this.list()).map((c) => c.name);
      if (!active.includes(moveTo)) throw new BadRequestException(`${moveTo} is not an active category`);
      pending = { from: cat.name, to: moveTo };
    } else if (inUse) {
      throw new BadRequestException(`${cat.name} is in use — choose a category to move it to`);
    }

    // Hiding it and reserving its name are one write: from here nothing new can pick it.
    const claimed = await this.model.findOneAndUpdate(
      { _id: cat._id, userId: this.userId, active: true, pending: null },
      { $set: { active: false, pending } },
    );
    if (!claimed) throw new ConflictException(`${cat.name} changed meanwhile — reload and try again`);
    if (pending) await this.completeMove(cat._id, pending);
  }

  /** Re-runs an interrupted move. */
  async finish(id: string): Promise<{ id: string }> {
    const cat = await this.findOwn(id);
    if (!cat.pending) throw new NotFoundException(`${cat.name} has no unfinished move`);
    await this.completeMove(cat._id, cat.pending);
    return { id: String(cat._id) };
  }

  private async completeMove(id: unknown, pending: Pending): Promise<void> {
    await this.refs.migrate(pending.from, pending.to);
    await this.model.updateOne({ _id: id }, { $set: { pending: null } });
  }

  private async findOwn(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such category');
    const cat = await this.model.findOne({ _id: id, userId: this.userId }).lean();
    if (!cat) throw new NotFoundException('No such category');
    return cat;
  }

  private async findEditable(id: string) {
    const cat = await this.findOwn(id);
    if (!cat.active || cat.pending) throw new ConflictException(`${cat.name} is being moved — finish that move first`);
    return cat;
  }

  /** Refuses a name held by an active custom category, or one an unfinished move is still moving away from. */
  private async assertNameFree(name: string, takenMessage: string): Promise<void> {
    const clash = await this.model
      .findOne({ userId: this.userId, $or: [{ name, active: true }, { 'pending.from': name }] })
      .lean();
    if (!clash) return;
    if (clash.active && clash.name === name) throw new ConflictException(takenMessage);
    throw new ConflictException(`${name} is still being moved — finish that move first`);
  }
}
```

- [ ] **Step 4: Implement the controller and module**

Replace the whole of `api/src/categories/categories.controller.ts` with:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CategoriesService, CategoryInput } from './categories.service';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list() {
    return this.categoriesService.list();
  }

  @Get('overview')
  overview() {
    return this.categoriesService.overview();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: CategoryInput) {
    return this.categoriesService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: CategoryInput) {
    return this.categoriesService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Query('moveTo') moveTo?: string) {
    await this.categoriesService.remove(id, moveTo);
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(@Param('id') id: string) {
    return this.categoriesService.finish(id);
  }
}
```

Replace the whole of `api/src/categories/categories.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomCategory, CustomCategorySchema } from '../shared/schemas/custom-category.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { Budget, BudgetSchema } from '../shared/schemas/budget.schema';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoryReferencesService } from './category-references.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomCategory.name, schema: CustomCategorySchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: Budget.name, schema: BudgetSchema },
    ]),
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryReferencesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

- [ ] **Step 5: Run to verify it passes, then the full suite and build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- categories.service transactions.controller 2>&1 | tail -5 && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```

Expected: 23 passed in `categories.service.spec.ts`; api **42 suites / 422 tests** (+19 in the categories spec, +1 guard case); build clean.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/categories/categories.service.ts api/src/categories/categories.service.spec.ts api/src/categories/categories.controller.ts api/src/categories/categories.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): create, edit, rename and delete custom categories safely

Create validates and revives a deleted name; edit changes emoji and colour
in place; a rename or a delete-and-move reserves the old name in one
guarded write, moves every reference, then clears pending; finish re-runs
an interrupted move; the overview returns usage and the options for new
categories.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Web — models and API calls

**Files:** Modify `web/src/app/core/services/api.models.ts`, `web/src/app/core/services/api.service.ts`.

- [ ] **Step 1: Models**

Append to `api.models.ts`:

```ts

export interface CategoryUsage {
  transactions: number;
  recurring: number;
  budgets: number;
}

export interface CategoryOverviewItem {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
  isBuiltIn: boolean;
  active: boolean;
  usage: CategoryUsage;
  pending: { from: string; to: string } | null;
}

export interface CategoryOverview {
  categories: CategoryOverviewItem[];
  palette: { label: string; hex: string }[];
  emojis: string[];
}

export interface CategoryInput {
  name?: string;
  emoji?: string;
  color?: string;
}
```

- [ ] **Step 2: Calls**

In `api.service.ts`, add `CategoryInput, CategoryOverview` to the `./api.models` import, then replace the existing `createCategory` and `deleteCategory` methods with:

```ts
  getCategoryOverview(): Observable<CategoryOverview> {
    return this.http.get<CategoryOverview>(`${this.base}/categories/overview`);
  }

  createCategory(body: { name: string; emoji: string; color: string }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/categories`, body);
  }

  updateCategory(id: string, body: CategoryInput): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`${this.base}/categories/${id}`, body);
  }

  /** `moveTo` is required by the api while the category is in use. */
  deleteCategory(id: string, moveTo?: string): Observable<void> {
    const params = moveTo ? new HttpParams().set('moveTo', moveTo) : undefined;
    return this.http.delete<void>(`${this.base}/categories/${id}`, { params });
  }

  finishCategoryMove(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/categories/${id}/finish`, {});
  }
```

- [ ] **Step 3: Build and commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/core/services/api.models.ts web/src/app/core/services/api.service.ts
git commit -F- <<'EOF'
feat(web): API calls for managing categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: only `web-done` before the commit.

---

### Task 6: Web — the Categories page, route and nav item

**Files:** Create `web/src/app/pages/categories/categories.component.{ts,html,scss}`; modify `web/src/app/app.routes.ts`, `web/src/app/app.component.ts`.

Deliberate difference from the spec's wording: the form's preview shows a colour dot beside the emoji and name, rather than the name written on the colour. White text fails contrast on the Yellow and Light palette colours.

- [ ] **Step 1: The component**

Create `web/src/app/pages/categories/categories.component.ts`:

```ts
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
```

- [ ] **Step 2: The template**

Create `web/src/app/pages/categories/categories.component.html`:

```html
<div class="page-wrap">
  <div class="cat-header">
    <div>
      <h1>Categories</h1>
      <p class="cat-muted">Your own categories for transactions, budgets and recurring rules.</p>
    </div>
    <button
      id="new-category"
      type="button"
      class="fc-btn fc-btn--primary"
      [disabled]="loading || !!loadError || busy || mode.kind !== 'none'"
      (click)="openCreate()"
    >
      <mat-icon>add</mat-icon> New category
    </button>
  </div>

  @if (loading) {
    <p class="cat-muted">Loading…</p>
  } @else if (loadError) {
    <p class="fc-error" role="alert">{{ loadError }}</p>
  } @else {
    @if (mode.kind === 'create') {
      <section class="card cat-section" aria-labelledby="cat-new-title">
        <h2 id="cat-new-title">New category</h2>
        <ng-container *ngTemplateOutlet="categoryForm" />
      </section>
    }

    <section class="card cat-section" aria-labelledby="cat-custom-title">
      <h2 id="cat-custom-title">Your categories</h2>
      @if (custom.length === 0) {
        <p class="cat-muted">No custom categories yet.</p>
      }
      <ul class="cat-list">
        @for (c of custom; track c.id) {
          <li class="cat-row">
            @if (mode.kind === 'edit' && mode.id === c.id) {
              <ng-container *ngTemplateOutlet="categoryForm" />
            } @else {
              <div class="cat-main">
                <span class="cat-swatch" [style.background]="c.color" aria-hidden="true"></span>
                <span class="cat-emoji" aria-hidden="true">{{ c.emoji }}</span>
                <div class="cat-text">
                  <span class="cat-name">{{ c.name }}</span>
                  <span class="cat-usage">{{ usageText(c.usage) }}</span>
                </div>
              </div>

              @if (c.pending) {
                <div class="cat-pending">
                  <p>Moving {{ c.pending.from }} to {{ c.pending.to }} didn't finish.</p>
                  <button type="button" class="fc-btn fc-btn--primary" [disabled]="busy" (click)="finish(c)">
                    Finish move
                  </button>
                  @if (finishError?.id === c.id) {
                    <p class="fc-error" role="alert">{{ finishError!.message }}</p>
                  }
                </div>
              } @else if (mode.kind === 'delete' && mode.id === c.id) {
                <div class="cat-delete">
                  @if (inUse(c)) {
                    <label class="fc-field">
                      <span>Move its {{ usageSentence(c.usage) }} to</span>
                      <select #firstField class="fc-input" [(ngModel)]="moveTo" name="moveTo">
                        <option value="" disabled>Choose a category</option>
                        @for (t of moveTargets(c); track t.name) {
                          <option [value]="t.name">{{ t.name }}</option>
                        }
                      </select>
                    </label>
                  } @else {
                    <p>Delete {{ c.name }}?</p>
                  }
                  @if (actionError) {
                    <p class="fc-error" role="alert">{{ actionError }}</p>
                  }
                  <div class="cat-actions">
                    <button type="button" class="fc-btn fc-btn--ghost" [disabled]="busy" (click)="close()">Cancel</button>
                    @if (inUse(c)) {
                      <button
                        type="button"
                        class="fc-btn cat-danger"
                        [disabled]="busy || !moveTo"
                        (click)="confirmDelete(c)"
                      >
                        {{ busy ? 'Moving…' : 'Delete and move' }}
                      </button>
                    } @else {
                      <button #firstField type="button" class="fc-btn cat-danger" [disabled]="busy" (click)="confirmDelete(c)">
                        {{ busy ? 'Deleting…' : 'Delete' }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="cat-row-actions">
                  <button
                    [id]="'edit-' + c.id"
                    type="button"
                    class="fc-btn fc-btn--ghost"
                    [disabled]="busy || mode.kind !== 'none'"
                    [attr.aria-label]="'Edit ' + c.name"
                    (click)="openEdit(c)"
                  >
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button
                    [id]="'delete-' + c.id"
                    type="button"
                    class="fc-btn fc-btn--ghost"
                    [disabled]="busy || mode.kind !== 'none'"
                    [attr.aria-label]="'Delete ' + c.name"
                    (click)="openDelete(c)"
                  >
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>
              }
            }
          </li>
        }
      </ul>
    </section>

    <section class="card cat-section" aria-labelledby="cat-builtin-title">
      <h2 id="cat-builtin-title">Built-in</h2>
      <p class="cat-muted">Built-in categories can't be changed.</p>
      <ul class="cat-list">
        @for (c of builtIns; track c.name) {
          <li class="cat-row">
            <div class="cat-main">
              <span class="cat-swatch" [style.background]="c.color" aria-hidden="true"></span>
              <span class="cat-emoji" aria-hidden="true">{{ c.emoji }}</span>
              <div class="cat-text">
                <span class="cat-name">{{ c.name }}</span>
                <span class="cat-usage">{{ usageText(c.usage) }}</span>
              </div>
            </div>
          </li>
        }
      </ul>
    </section>
  }
</div>

<ng-template #categoryForm>
  <form class="cat-form" (ngSubmit)="save()">
    <label class="fc-field">
      <span>Name</span>
      <input #firstField class="fc-input" type="text" maxlength="40" autocomplete="off" [(ngModel)]="name" name="name" />
    </label>
    <p class="cat-hint" aria-live="polite">{{ nameCheck }}</p>

    <div class="cat-picker" role="group" aria-label="Emoji">
      @for (e of overview!.emojis; track e) {
        <button
          type="button"
          class="cat-pick"
          [class.active]="emoji === e"
          [attr.aria-pressed]="emoji === e"
          [attr.aria-label]="e"
          (click)="emoji = e"
        >
          {{ e }}
        </button>
      }
    </div>

    <div class="cat-picker" role="group" aria-label="Colour">
      @for (p of overview!.palette; track p.hex) {
        <button
          type="button"
          class="cat-swatch-btn"
          [class.active]="color === p.hex"
          [attr.aria-pressed]="color === p.hex"
          [attr.aria-label]="p.label"
          [style.background]="p.hex"
          (click)="color = p.hex"
        ></button>
      }
    </div>

    <p class="cat-preview">
      <span class="cat-swatch" [style.background]="color || null" aria-hidden="true"></span>
      <span>{{ emoji }} {{ normalizedName || 'name' }}</span>
    </p>
    @if (renameNote) {
      <p class="cat-muted">{{ renameNote }}</p>
    }
    @if (actionError) {
      <p class="fc-error" role="alert">{{ actionError }}</p>
    }
    <div class="cat-actions">
      <button type="button" class="fc-btn fc-btn--ghost" [disabled]="busy" (click)="close()">Cancel</button>
      <button type="submit" class="fc-btn fc-btn--primary" [disabled]="!canSave">
        {{ busy ? 'Saving…' : mode.kind === 'edit' ? 'Save' : 'Create' }}
      </button>
    </div>
  </form>
</ng-template>
```

- [ ] **Step 3: The styles (tokens only)**

Create `web/src/app/pages/categories/categories.component.scss`:

```scss
.cat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);

  h1 {
    margin: 0;
    font-size: var(--text-page-title);
  }
}

.cat-muted,
.cat-hint {
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.cat-hint:empty {
  display: none;
}

.cat-section {
  margin-bottom: var(--space-lg);

  h2 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-lg);
  }
}

.cat-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--border);

  &:first-child {
    border-top: none;
  }
}

.cat-main {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.cat-swatch {
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--border);
}

.cat-emoji {
  font-size: var(--text-lg);
}

.cat-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cat-name {
  color: var(--text);
  overflow-wrap: anywhere;
}

.cat-usage {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.cat-row-actions,
.cat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.cat-actions {
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.cat-pending,
.cat-delete,
.cat-form {
  flex: 1 1 100%;
}

.cat-pending p,
.cat-delete p {
  margin: 0 0 var(--space-xs);
  color: var(--text);
}

.cat-picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin-top: var(--space-sm);
}

.cat-pick {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: none;
  font-size: var(--text-lg);
  padding: var(--space-3xs) var(--space-2xs);
  cursor: pointer;

  &:hover:not(.active) {
    background: var(--color-surface-hover);
  }

  &.active {
    border-color: var(--accent);
    background: var(--color-surface-hover);
  }
}

.cat-swatch-btn {
  width: 28px;
  height: 28px;
  border: 2px solid transparent;
  border-radius: var(--radius-pill);
  cursor: pointer;

  &.active {
    border-color: var(--text);
  }
}

.cat-pick,
.cat-swatch-btn {
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
}

.cat-preview {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin: var(--space-sm) 0 0;
  color: var(--text);
}

.cat-danger {
  background: var(--expense);
  border-color: var(--expense);
  color: var(--color-accent-ink);

  &:hover:not(:disabled) {
    opacity: 0.85;
  }
}
```

- [ ] **Step 4: Route and nav item**

In `web/src/app/app.routes.ts`, add directly after the `recurring` route object:

```ts
  {
    path: 'categories',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/categories/categories.component').then((m) => m.CategoriesComponent),
  },
```

In `web/src/app/app.component.ts`, add directly after the `Recurring` nav entry, keeping the file's column alignment:

```ts
    { label: 'Categories',   icon: 'sell',                   path: '/categories' },
```

- [ ] **Step 5: Build and check styles**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff -- web | grep -nE "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()"; echo literal-done
```

Expected: only `web-done` and `literal-done` (a new `categories-component` chunk in the build table is not a warning). If the build reports a component style budget warning, report it — do not raise the budget.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/categories/categories.component.ts web/src/app/pages/categories/categories.component.html web/src/app/pages/categories/categories.component.scss web/src/app/app.routes.ts web/src/app/app.component.ts
git commit -F- <<'EOF'
feat(web): Categories page — create, edit, rename and delete with a move

New categories with the bot's emoji and colours and a live name check;
edit in place with a rename note; delete that asks where everything goes
while the category is in use; Finish move for an interrupted move; the
built-ins read-only. Every change refreshes the app's pickers and lists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: README

- [ ] **Step 1: Document**

In `README.md`:

1. In the Web Dashboard features table, directly after the row starting `| **Recurring** | Create rules`, add:

```markdown
| **Categories** | Create, edit, rename and delete your own categories; deleting one in use moves its transactions, recurring rules and budgets to a category you choose |
```

2. In the API reference table, directly after the row `` | `POST` | `/api/reports/test` | Email the latest weekly digest now, marked [Test] | ``, add:

```markdown
| `GET` | `/api/categories` | Built-in and active custom categories |
| `GET` | `/api/categories/overview` | Every category with its usage, plus the palette and emoji for new ones |
| `POST` | `/api/categories` | Create a category `{ name, emoji, color }` |
| `PATCH` | `/api/categories/:id` | Change emoji or colour; a new name renames it everywhere |
| `DELETE` | `/api/categories/:id?moveTo=` | Delete, moving everything that uses it to `moveTo` |
| `POST` | `/api/categories/:id/finish` | Finish an interrupted move |
```

- [ ] **Step 2: Verify and commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && grep -cE "\*\*Categories\*\*|/api/categories" README.md
git add README.md
git commit -F- <<'EOF'
docs(readme): the Categories page and its endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: `7` before the commit (1 feature row, 6 API rows).

---

### Task 8: Final verification (no commit unless something is wrong)

- [ ] **Step 1: Suites and builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/repo" && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```

Expected: api **42 suites / 422 tests**, build clean; repo **14 / 83**, build clean; web clean.

- [ ] **Step 2: Hygiene**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git log --format=%B -7 | grep -c "Co-Authored-By: Claude Opus 5.5"
git grep -nE "categoriesService\.(create|delete)\(" -- api/src
git status --short
```

Expected: `7`; the `git grep` shows only `categoriesService.create(` in the controller (the old `delete(id)` method no longer exists); clean tree. The controller runs the private-identifier check separately.

---

## After the tasks (controller)

1. Spec review, then code-quality review; fixes; a preview-harness screenshot of the page (desktop and phone); private-identifier gate; push.
2. Hand the user: restart `accounting-api` and `accounting-web` once CI is green; open **Categories**; create one, rename it, then delete it into another category and watch the usage move.

## As built (2026-09-24)

Tasks 1–7 landed as written in `cbaf83c`, `5d8b004`, `5f2c212`, `203b9e6`, `50de781`, `dfd877e` and `272fd81`. Counts matched the plan (api 42 suites / 422 tests).

**Preview:** a scratch harness rendered the real component against fake data, with screenshots at 1280 px and 375 px. They show:
- the create form's live hint for "Coffee Shop";
- the other rows locked while a form is open;
- the delete-and-move sentence "Move its 12 transactions, 1 recurring rule and 2 budgets to", with the category itself and a mid-move one left out of the targets;
- no horizontal scroll at phone width.

**Spec review:** close, but not compliant. Every move trace was correct: delete, an interruption followed by Finish, rename, reserved names, revival and validation. Fixed in `333e451` and `a9d52d9`:
- A move's destination is locked until the move finishes: the api answers 409 and the page disables Edit and Delete. Without the lock, finishing would put the rest of the data under a dead name, and a recurring rule there would book to it every month.
- A failed change reloads the page, so an interrupted move shows its Finish move.
- `migrate(x, x)` does nothing. It used to delete every budget of `x`.
- A legacy custom category carrying a built-in's name is hidden without moving the built-in's data, and can't be renamed.
- Tests that couldn't fail now can.
- Errors keep their colour, and Finish move waits while another form is open.

**Code-quality review:** no critical issues; ready once fixed. Fixed in `152966d`, `c9403d3` and `e804c70`:
- **The page could lock up.** If the category being edited or deleted was deleted in another tab, every button stayed disabled. The form now closes and the error shows on the page.
- **The legacy built-in-named category couldn't be deleted from the page.** It showed the built-in's usage, so the page always asked for a move, which the api refuses. It now shows no usage of its own.
- **Guarded writes.** The delete claim pins the name. Clearing `pending` clears only the move that just finished, so a newer move is never wiped.
- **Budgets check their category.** `BudgetService.set` now validates against the active list, which the spec says every writer does.
- **Focus and accessibility.** Focus returns after every failure and after a reload that re-renders rows. A lock's reason is visible text tied to the disabled buttons. Each Finish move names its move.
- **Colours.** `CategoryService` rebuilds its colour map, so a deleted or renamed category stops keeping its colour.

**Decided:** a legacy name that isn't normalized (for example `Gym`, or `Side Income`) is normalized on its first edit from the page, because the page always sends the rule-conforming name. A name that can't be normalized (`Side Income`) must be renamed before saving. This moves legacy data onto the rule; the api still accepts an emoji-only change.

Final: api 42 suites / 432 tests, repo 14 / 83, web build clean with zero warnings.

## Follow-ups

- **Two tabs moving at the same moment.** The destination lock is check-then-act. Tab A moves `gym` into `travel` while tab B moves `travel` elsewhere, both between each other's checks. If A's transactions step runs after B's, `gym`'s data ends up under the dead `travel`. Fix: after each claim, re-check the other side, and undo your own claim with a 409 on a collision. For a move, check that the target is still active and not a `pending.from`; for a category, check that it has no incoming `pending.to`. Both sides write before they read, so at least one of them sees the other.
- **The known race, in full.** A write under the old name that lands after `migrate` has passed that collection stays under the old name. The writers:
  - the ingester;
  - web writes (transactions, recurring rules, budgets): each validates against the active list, but a request already past validation when the claim lands can still write;
  - the recurring scheduler, which books a rule it read before the rename under the old name.

  Such a row keeps a dead name until it is edited. A fix would re-run `migrate` a few minutes after a move completes.
- **No database uniqueness for names.** Two simultaneous creates of the same name can both pass `assertNameFree`. Fix: a partial unique index on `{ userId, name }` for `active: true`, after checking the existing data for duplicates.
- **Renaming onto a deleted category's name** leaves an inactive record with the same name beside the active one. Everything reads `active: true`, so nothing misbehaves; tidy it up if the unique index lands.
- **References a delete doesn't move.** Usage counts only live transactions and active rules. A delete without a move therefore leaves soft-deleted transactions and inactive rules under the dead name. A future restore feature must re-validate their category.
- **The Budget page's "Create Category" placeholder card** could link to `/categories`.
