# Merchant Memory and One-Click Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One decision per merchant. The user's category choices on bank-mail expenses are remembered and applied, and AI guesses are confirmed in one click.

**Architecture:**
- **The memory.** A `MerchantCategory` store, keyed by a normalized merchant name. `MerchantMemoryService` teaches it from the pre-image of every category change, files the same merchant's rows still waiting for review, and hands ingestion the whole map once per run.
- **Ingestion** checks the memory before the rules and Mistral.
- **The Transactions page** shows the guess with a ✓.

**Tech Stack:** NestJS 10, Mongoose 8, Jest, pnpm; Angular 17 standalone (no test runner).

**Spec:** `docs/superpowers/specs/2026-09-25-merchant-memory-design.md`.

---

## Ground rules for every task

- **Paths.** Repo root: `C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot`. Use Git Bash, and `cd` with an absolute path in every command.
- **Branch.** Work on `main`. **Never push, amend, rebase or reset.** Stage with `git add <explicit paths>` only.
- **Commits.** Every message ends with a blank line and exactly one trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo.** Generic test data only: "prime video", "some store".
- **Baseline.** Before Task 1, the api has **60 suites / 641 tests**, all passing, and Jest runs in America/Santo_Domingo. Report the exact counts after each task.
- **Web.** Theme tokens only in stylesheets.

---

### Task 1: The merchant key and the store's schema

**Files:**
- Create: `api/src/merchants/merchant-key.ts` (+ `merchant-key.spec.ts`)
- Create: `api/src/shared/schemas/merchant-category.schema.ts` (+ spec)

- [ ] **Step 1: Write the failing tests**

`merchant-key.spec.ts`:
```ts
import { merchantKey } from './merchant-key';

describe('merchantKey', () => {
  it('drops reference codes so every charge from a merchant shares one key', () => {
    expect(merchantKey('PRIME VIDEO*2K3JD')).toBe('prime video');
    expect(merchantKey('prime video*9xq1')).toBe('prime video');
    expect(merchantKey('SOME STORE #1234')).toBe('some store');
  });

  it('keeps words, splitting on spaces, * and #', () => {
    expect(merchantKey('PedidosYa*Expreso  Bonny')).toBe('pedidosya expreso bonny');
  });

  it('gives an empty key for a name with nothing but codes', () => {
    expect(merchantKey('12345 #99')).toBe('');
    expect(merchantKey(undefined)).toBe('');
  });
});
```
`merchant-category.schema.spec.ts`:
```ts
import { MerchantCategorySchema } from './merchant-category.schema';

describe('MerchantCategorySchema', () => {
  it('keeps one remembered category per merchant', () => {
    expect(MerchantCategorySchema.indexes()).toContainEqual([
      { userId: 1, key: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- merchant 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

`merchant-key.ts`:
```ts
/**
 * A bank merchant name reduced to what stays the same between charges:
 * lowercase words, with every token that contains a digit (reference codes
 * such as "2K3JD" or "#1234") dropped. Empty means "no usable key".
 */
export function merchantKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .split(/[\s*#]+/)
    .filter((token) => token && !/\d/.test(token))
    .join(' ');
}
```
`merchant-category.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** The category the user last chose for a bank merchant (see MerchantMemoryService). */
@Schema()
export class MerchantCategory extends Document {
  @Prop({ required: true }) userId: number;
  /** merchantKey() of the bank's merchant name. */
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) category: string;
  @Prop() updatedAt: Date;
}

export const MerchantCategorySchema = SchemaFactory.createForClass(MerchantCategory);

MerchantCategorySchema.index({ userId: 1, key: 1 }, { unique: true });
```

- [ ] **Step 4: Run the suite, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/merchants/merchant-key.ts api/src/merchants/merchant-key.spec.ts api/src/shared/schemas/merchant-category.schema.ts api/src/shared/schemas/merchant-category.schema.spec.ts
git commit -F- <<'EOF'
feat(api): a stable key per bank merchant, and a store for remembered categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `MerchantMemoryService` and its module

**Files:**
- Create: `api/src/merchants/merchant-memory.service.ts` (+ spec)
- Create: `api/src/merchants/merchants.module.ts`

- [ ] **Step 1: Write the failing test**

`merchant-memory.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { MerchantMemoryService } from './merchant-memory.service';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const row = (over: Record<string, unknown> = {}) => ({
  _id: 't1', source: 'email', amount: -10, merchant: 'PRIME VIDEO*2K3JD', transactionName: 'prime video*2k3jd', ...over,
});

describe('MerchantMemoryService', () => {
  let service: MerchantMemoryService;
  let memoryModel: { updateOne: jest.Mock; find: jest.Mock };
  let txModel: { find: jest.Mock; updateMany: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    memoryModel = { updateOne: jest.fn().mockResolvedValue({}), find: jest.fn(() => query([])) };
    txModel = { find: jest.fn(() => query([])), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) };
    const mod = await Test.createTestingModule({
      providers: [
        MerchantMemoryService,
        { provide: getModelToken(MerchantCategory.name), useValue: memoryModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
      ],
    }).compile();
    service = mod.get(MerchantMemoryService);
  });

  it("remembers the user's choice for the merchant; the last choice wins", async () => {
    await service.learn(row(), 'entertainment');
    expect(memoryModel.updateOne).toHaveBeenCalledWith(
      { userId: 1, key: 'prime video' },
      { $set: { category: 'entertainment', updatedAt: expect.any(Date) } },
      { upsert: true },
    );
  });

  it("files the same merchant's other rows still waiting for review, and says how many", async () => {
    const pending = query([
      { _id: 't2', merchant: 'PRIME VIDEO*9XQ1' },
      { _id: 't3', merchant: 'SOME STORE' },
      { _id: 't4', transactionName: 'prime video*zz7' },
    ]);
    txModel.find.mockReturnValue(pending);
    txModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
    await expect(service.learn(row(), 'entertainment')).resolves.toBe(2);
    expect(txModel.find).toHaveBeenCalledWith({
      userId: 1,
      source: 'email',
      categoryNeedsReview: true,
      amount: { $lt: 0 },
      isWithdrawal: { $ne: true },
      deletedAt: null,
      _id: { $ne: 't1' },
    });
    expect(pending.select).toHaveBeenCalledWith('merchant transactionName');
    expect(txModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['t2', 't4'] }, categoryNeedsReview: true },
      { $set: { category: 'entertainment', categoryNeedsReview: false } },
    );
  });

  it.each([
    ['income', { amount: 500 }],
    ['an ATM withdrawal', { isWithdrawal: true }],
    ['a transfer between own accounts', { transferKind: 'internal' }],
    ['an unresolved transfer', { transferKind: 'unresolved' }],
    ['a row not from bank mail', { source: 'manual' }],
    ['a merchant with no usable key', { merchant: '12345', transactionName: '12345' }],
  ])('learns nothing from %s', async (_label, over) => {
    await expect(service.learn(row(over), 'food')).resolves.toBe(0);
    expect(memoryModel.updateOne).not.toHaveBeenCalled();
    expect(txModel.updateMany).not.toHaveBeenCalled();
  });

  it("never fails the user's change: a failure is logged and counts 0", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    memoryModel.updateOne.mockRejectedValue(new Error('db down'));
    await expect(service.learn(row(), 'food')).resolves.toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('hands ingestion every remembered merchant', async () => {
    memoryModel.find.mockReturnValue(query([{ key: 'prime video', category: 'entertainment' }, { key: 'some store', category: 'food' }]));
    const map = await service.all();
    expect(memoryModel.find).toHaveBeenCalledWith({ userId: 1 });
    expect([...map.entries()]).toEqual([['prime video', 'entertainment'], ['some store', 'food']]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- merchant-memory 2>&1 | tail -6
```

- [ ] **Step 3: Implement**

`merchant-memory.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
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
    return new Map(rows.map((r) => [r.key, r.category]));
  }

  /**
   * Called after the user set `category` on `row` (as it was before the change).
   * Returns how many other waiting rows it filed. Never throws: the user's change
   * is already saved, so a failure here is only logged.
   */
  async learn(row: TeachableRow, category: string): Promise<number> {
    const key = merchantKey(row.merchant || row.transactionName);
    const teaches =
      row.source === 'email' && row.amount < 0 && !row.isWithdrawal && !isNonSpendingTransfer(row.transferKind) && key !== '';
    if (!teaches) return 0;
    try {
      await this.memoryModel.updateOne(
        { userId: this.userId, key },
        { $set: { category, updatedAt: new Date() } },
        { upsert: true },
      );
      const waiting = await this.txModel
        .find({
          userId: this.userId,
          source: 'email',
          categoryNeedsReview: true,
          amount: { $lt: 0 },
          isWithdrawal: { $ne: true },
          ...NOT_DELETED,
          _id: { $ne: row._id },
        })
        .select('merchant transactionName')
        .lean();
      const ids = waiting.filter((t) => merchantKey(t.merchant || t.transactionName) === key).map((t) => t._id);
      if (ids.length === 0) return 0;
      const res = await this.txModel.updateMany(
        { _id: { $in: ids }, categoryNeedsReview: true },
        { $set: { category, categoryNeedsReview: false } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Could not remember ${category} for "${key}"`, err instanceof Error ? err.stack : String(err));
      return 0;
    }
  }
}
```
`merchants.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MerchantCategory, MerchantCategorySchema } from '../shared/schemas/merchant-category.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { MerchantMemoryService } from './merchant-memory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MerchantCategory.name, schema: MerchantCategorySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  providers: [MerchantMemoryService],
  exports: [MerchantMemoryService],
})
export class MerchantsModule {}
```

- [ ] **Step 4: Run the suite and the build, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/merchants/merchant-memory.service.ts api/src/merchants/merchant-memory.service.spec.ts api/src/merchants/merchants.module.ts
git commit -F- <<'EOF'
feat(api): remember each bank merchant's category and file its waiting rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Category changes teach the memory

**Files:**
- Modify: `api/src/transactions/transactions.service.ts` (`setCategory`, `update`, constructor)
- Modify: `api/src/transactions/transactions.controller.ts` (the category route)
- Modify: `api/src/transactions/transactions.module.ts`
- Test: `api/src/transactions/transactions.service.spec.ts` (and the controller spec if it pins the route's status)

- [ ] **Step 1: Write the failing tests**

In `transactions.service.spec.ts`:
- Add `import { MerchantMemoryService } from '../merchants/merchant-memory.service';` and `const memory = { learn: jest.fn().mockResolvedValue(0) };`. Add the provider `{ provide: MerchantMemoryService, useValue: memory }`, and re-set `memory.learn.mockResolvedValue(0)` after `jest.clearAllMocks()` in `beforeEach`.
- In `describe('setCategory')`, add:
```ts
    it('teaches the memory from the row as it was, and reports what else it filed', async () => {
      const before = { _id: 'tx1', source: 'email', amount: -10, merchant: 'PRIME VIDEO*2K3JD', categoryNeedsReview: true };
      mockModel.findOneAndUpdate.mockResolvedValueOnce(before);
      memory.learn.mockResolvedValueOnce(1);
      await expect(service.setCategory('tx1', 'food')).resolves.toEqual({ alsoFiled: 1 });
      expect(memory.learn).toHaveBeenCalledWith(before, 'food');
    });

    it('files nothing for a row that no longer exists', async () => {
      mockModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(service.setCategory('tx1', 'food')).resolves.toEqual({ alsoFiled: 0 });
      expect(memory.learn).not.toHaveBeenCalled();
    });
```
- In `describe('update')`, add:
```ts
    it('teaches the memory when the edit changes the category', async () => {
      const before = live({ source: 'email', merchant: 'SOME STORE' });
      mockModel.findOne.mockResolvedValue(before);
      await service.update('t1', { category: 'other' });
      expect(memory.learn).toHaveBeenCalledWith(before, 'other');
    });

    it('teaches nothing when the edit leaves the category alone', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { name: 'renamed' });
      expect(memory.learn).not.toHaveBeenCalled();
    });
```
  `live()` is the existing fixture in that describe. The category `'other'` must pass the spec's mocked `assertValid`, which allows `'food'`, `'other'` and `'Gym'`.

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- transactions 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 3: Implement**

- **Constructor:** add `private readonly memory: MerchantMemoryService,` last (import it from `'../merchants/merchant-memory.service'`).
- **`setCategory`:** replace it with:
```ts
  /** Sets a row's category and clears its review flag; a bank-mail expense also teaches the merchant memory. */
  async setCategory(id: string, category: string): Promise<{ alsoFiled: number }> {
    await this.categories.assertValid(category);
    const before = await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId, ...NOT_DELETED },
      { category, categoryNeedsReview: false },
    );
    if (!before) return { alsoFiled: 0 };
    return { alsoFiled: await this.memory.learn(before, category) };
  }
```
- **`update`:** at its very end, after the ledger block (so a failed ledger path, which returns through `compensate`, never teaches), add:
```ts
    if (body.category !== undefined) await this.memory.learn(tx, body.category);
```
  If `update` returns early when nothing changed (`if (Object.keys(patch).length === 0) return;`), that path has no category change and needs nothing.
- **Controller:** on the `@Patch(':id/category')` route, change `@HttpCode(204)` to `@HttpCode(200)`, and return the service result: `return this.transactionsService.setCategory(id, body.category);` (drop `async`/`await` if they're no longer needed). If a controller spec pins 204 for this route, update it to 200.
- **`transactions.module.ts`:** add `MerchantsModule` (from `'../merchants/merchants.module'`) to `imports`.

- [ ] **Step 4: Run the suite and the build, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/transactions/transactions.service.ts api/src/transactions/transactions.service.spec.ts api/src/transactions/transactions.controller.ts api/src/transactions/transactions.module.ts
git status --short
git commit -F- <<'EOF'
feat(api): setting a bank-mail expense's category teaches its merchant

PATCH /transactions/:id/category now answers { alsoFiled }: how many of
the merchant's other rows waiting for review it filed too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Also add the controller spec if you changed it.

---

### Task 4: Ingestion files remembered merchants first

**Files:**
- Modify: `api/src/ingestion/ingestion.service.ts` (`RunContext`, `loadRunContext`, the category choice)
- Modify: `api/src/ingestion/ingestion.module.ts`
- Test: `api/src/ingestion/ingestion.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `ingestion.service.spec.ts`:
- Add `import { MerchantMemoryService } from '../merchants/merchant-memory.service';` and `let memory: { all: jest.Mock };`. In `beforeEach`, set `memory = { all: jest.fn().mockResolvedValue(new Map()) };` and add the provider.
- Tests:
```ts
  it('files a remembered merchant straight away: no review, no AI', async () => {
    memory.all.mockResolvedValue(new Map([['prime video', 'food']]));
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ counterparty: 'PRIME VIDEO*2K3JD' }));

    await service.run();

    const created = txModel.create.mock.calls[0][0];
    expect(created.category).toBe('food');
    expect(created.categoryNeedsReview).toBe(false);
    expect(categorizer.categorize).not.toHaveBeenCalled();
  });

  it('asks the categorizer when the remembered category no longer exists', async () => {
    memory.all.mockResolvedValue(new Map([['prime video', 'gone']]));
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed({ counterparty: 'PRIME VIDEO*2K3JD' }));

    await service.run();

    expect(categorizer.categorize).toHaveBeenCalled();
  });

  it('never applies the memory to income or ATM withdrawals', async () => {
    memory.all.mockResolvedValue(new Map([['cajero automatico', 'food'], ['some wire', 'food']]));
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' }), makeMail({ messageId: 'm2' })]);
    parserParseMock
      .mockReturnValueOnce(makeParsed({ isWithdrawal: true, counterparty: 'Cajero Automatico' }))
      .mockReturnValueOnce(makeParsed({ direction: 'income', counterparty: 'Some Wire' }));

    await service.run();

    expect(txModel.create.mock.calls[0][0].category).toBe('cash');
    expect(txModel.create.mock.calls[1][0].category).toBe('other');
  });
```
  The spec's `categories.list` mock returns `food`, `other` and `Gym`, so `'food'` is allowed and `'gone'` isn't. Also extend the existing test `'loads custom categories and recurring rules once per run, not once per mail'` with `expect(memory.all).toHaveBeenCalledTimes(1);`.

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ingestion.service 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 3: Implement**

In `ingestion.service.ts`:
- Import `MerchantMemoryService` (from `'../merchants/merchant-memory.service'`) and `merchantKey` (from `'../merchants/merchant-key'`), and add the constructor parameter `private readonly memory: MerchantMemoryService,` last.
- `RunContext` gains:
```ts
  /** Bank merchants the user already categorized: merchantKey → category. */
  remembered: Map<string, string>;
```
- `loadRunContext()` adds `remembered: await this.memory.all(),` to the returned object.
- Replace the category choice with:
```ts
    const remembered = ctx.remembered.get(merchantKey(p.counterparty));
    const { category, needsReview } =
      p.direction === 'income'
        ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
        : p.isWithdrawal
          ? { category: Category.CASH, needsReview: false } // cash out of an ATM: itemized later on the web
          : remembered && ctx.allowed.includes(remembered)
            ? { category: remembered, needsReview: false } // the user already decided this merchant
            : await this.categorizer.categorize(p.counterparty, ctx.allowed);
```
In `ingestion.module.ts`, add `MerchantsModule` to `imports`.

- [ ] **Step 4: Run the suite and the build, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts api/src/ingestion/ingestion.module.ts
git commit -F- <<'EOF'
feat(api): bank mail from a merchant the user already categorized skips review and AI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Categories page moves remembered choices

**Files:**
- Modify: `api/src/categories/category-references.service.ts`, `api/src/categories/categories.module.ts`
- Test: `api/src/categories/category-references.service.spec.ts`

- [ ] **Step 1: Write the failing test**

- In the spec, add `import { MerchantCategory } from '../shared/schemas/merchant-category.schema';` and `let memoryModel: { updateMany: jest.Mock };`. Initialize it in `beforeEach` as `{ updateMany: jest.fn().mockResolvedValue({}) }`, with the provider `{ provide: getModelToken(MerchantCategory.name), useValue: memoryModel }`.
- Add:
```ts
  it('moves remembered merchant choices along, after the cash items', async () => {
    await service.migrate('gym', 'health');
    expect(memoryModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0];
    expect(order(itemModel.updateMany)).toBeLessThan(order(memoryModel.updateMany));
    expect(order(memoryModel.updateMany)).toBeLessThan(order(recurringModel.updateMany));
  });
```
- In the existing "does nothing when moving a name to itself" test, also expect `memoryModel.updateMany` not to have been called.

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- category-references 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 3: Implement**

- **`category-references.service.ts`:** add the constructor parameter `@InjectModel(MerchantCategory.name) private readonly memoryModel: Model<MerchantCategory>,` last. In `migrate`, directly after the cash-items `updateMany`, add:
```ts
    // Remembered merchant choices (see MerchantMemoryService) follow the category too.
    await this.memoryModel.updateMany({ userId: this.userId, category: from }, { $set: { category: to } });
```
- **`categories.module.ts`:** add `{ name: MerchantCategory.name, schema: MerchantCategorySchema }` to `forFeature`, with the imports. It registers the model itself, as it does `CashAllocation`, so it doesn't import `MerchantsModule`.

- [ ] **Step 4: Run the suite and the build, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/categories/category-references.service.ts api/src/categories/category-references.service.spec.ts api/src/categories/categories.module.ts
git commit -F- <<'EOF'
feat(api): renaming or moving a category carries its remembered merchants along

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: One-click review on the Transactions page

**Files:**
- Modify: `web/src/app/core/services/api.service.ts` (`setTransactionCategory`)
- Modify: `web/src/app/pages/transactions/transactions.component.{ts,html,scss}`

- [ ] **Step 1: The api call**

```ts
  /** Sets a category and clears the review flag; also answers how many of the merchant's other waiting rows were filed. */
  setTransactionCategory(id: string, category: string): Observable<{ alsoFiled: number }> {
    return this.http.patch<{ alsoFiled: number }>(`${this.base}/transactions/${id}/category`, { category });
  }
```

- [ ] **Step 2: The component**

- Add a field `filedNote = '';`.
- Replace `assignCategory` with:
```ts
  assignCategory(tx: Transaction, category: string) {
    if (!category || this.pendingId) return;
    this.pendingId = tx._id;
    this.filedNote = '';
    this.api.setTransactionCategory(tx._id, category).subscribe({
      next: ({ alsoFiled }) => {
        this.pendingId = null;
        tx.category = category;
        tx.categoryNeedsReview = false;
        if (alsoFiled > 0) {
          this.filedNote = `Also filed ${alsoFiled} other ${tx.transactionName} ${alsoFiled === 1 ? 'row' : 'rows'} as ${category}.`;
          this.events.notify(); // the other rows changed too: reload in place
        }
      },
      error: () => {
        this.pendingId = null;
        alert('Failed to set category. Please try again.');
      },
    });
  }
```

- [ ] **Step 3: The template**

- Replace the `@if (tx.categoryNeedsReview) { <select …>…</select> }` branch of the category cell with:
```html
            @if (tx.categoryNeedsReview) {
              <div class="review-cell">
                <span class="cat-pill guess-pill"
                      [style.background]="catColor(tx.category) + '22'"
                      [style.color]="catColor(tx.category)">
                  <span class="dot" [style.background]="catColor(tx.category)"></span>
                  {{ tx.category | titlecase }}?
                </span>
                <button type="button" class="icon-act confirm-guess"
                        [disabled]="pendingId === tx._id"
                        [attr.aria-label]="'Confirm ' + (tx.category | titlecase) + ' for ' + tx.transactionName"
                        (click)="assignCategory(tx, tx.category)">
                  <mat-icon>check</mat-icon>
                </button>
                <select class="review-select"
                        [attr.aria-label]="'Category for ' + tx.transactionName"
                        [disabled]="pendingId === tx._id"
                        (change)="assignCategory(tx, $any($event.target).value)">
                  @for (cat of categories; track cat) {
                    <option [value]="cat" [selected]="cat === tx.category">{{ cat | titlecase }}</option>
                  }
                </select>
              </div>
            }
```
- Directly after the `@if (error) { … }` block above the table, add:
```html
  <p class="filed-note" aria-live="polite">{{ filedNote }}</p>
```

- [ ] **Step 4: Styles** (`transactions.component.scss`, tokens only)

```scss
// ── Review a category guess ────────────────────────────────────────────
.review-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.guess-pill { font-style: italic; }
.confirm-guess mat-icon { color: var(--income); }
.filed-note { margin: 0 0 8px; min-height: 1em; font-size: 0.85rem; color: var(--text-muted); }
```

- [ ] **Step 5: Build, check, commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff -- web | grep -nE "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()"; echo literal-done
git add web/src/app/core/services/api.service.ts web/src/app/pages/transactions/transactions.component.ts web/src/app/pages/transactions/transactions.component.html web/src/app/pages/transactions/transactions.component.scss
git commit -F- <<'EOF'
feat(web): review a category guess in one click; the merchant's other rows follow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: `web-done` alone and `literal-done` alone. The `+ '22'` alpha suffix in the template's `[style.background]` is the page's existing pill pattern, not a stylesheet literal.

---

### Task 7: README and final checks

- [ ] **Step 1:** In `README.md`'s feature table, extend the email-ingestion row, or add a row after it, with: "Remembers the category you choose for each bank merchant, so later charges from it are filed without review; AI guesses are confirmed in one click."

- [ ] **Step 2: Suites, builds, commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add README.md
git commit -F- <<'EOF'
docs(readme): merchant memory and one-click review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format=%B -7 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```
Expected: `7`, and a clean tree.

---

## After the tasks (controller)

1. A combined review, fixes, the private-identifier gate, and the push.
2. Hand the user: restart `accounting-api` and `accounting-web` once CI is green, then press ✓ on one Prime Video row. The other waiting Prime Video row should file itself, and the next Prime Video charge should arrive already filed.

## As built (2026-09-25)

Tasks 1–7 landed as written in `983965c`, `a022d8a`, `4aa455e`, `6a68e88`, `23b36d5`, `9a232b1` and `1583cdf` (641 → 663 tests). Two deviations:
- No controller spec pinned the old 204.
- The README gained its own "Merchant memory" row.

**Review:** compliant, with 23 of 29 mutants caught. Fixed in `5044778` and `91b81e5`:
- **Only real choices teach.** The web edit form always sends the category, so fixing a row's name used to re-teach its old category and undo a later choice. A category now teaches only when it changed, or when the row was waiting for review.
- **Placeholders aren't merchants.** Parser placeholders ("Transferencia", "Transferencia enviada", "Desconocido"), now shared constants, and generic words ("pago", "compra", "paypal") give an empty key. One choice used to auto-file every unnamed transfer.
- **`cash` and `other` never teach,** and transfers between own accounts are never filed by the memory.
- **The review page:** each row's review is independent. A second quick ✓ used to be dropped, and a failed change leaves the dropdown on the saved value. Focus moves to the next ✓, and the note names the merchant without its codes.
- **Tests now pin** the route's 200 `{ alsoFiled }`, no teaching on the rolled-back edit path, `merchant` taking precedence over `transactionName`, and `#` as a separator.

Final: api 63 suites / 674 tests, web build clean.

## Follow-ups

- **One snapshot per run.** A choice made while an ingestion run is in progress doesn't reach mail booked later in that same run. The next ✓, or the next run, covers it.
- **Removed categories in the dropdown.** If a guess names a category that has since been deactivated, the dropdown shows its first option, and choosing that option fires no change. Use ✓ or pick another category.
- **Nothing to review what's remembered.** There's no list of remembered merchants yet; a later choice overrides an earlier one.
- **Named transfers teach.** A transfer to a named beneficiary teaches like a card merchant; a loan payment keyed by the user's own name is the weakest case.
