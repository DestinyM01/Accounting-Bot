# Recurring Scheduler in the API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The api books recurring rules itself with an hourly sweep that catches up missed occurrences (31-day window), and the Telegram bot is scaled to zero with its recurring cron deleted.

**Architecture:** A pure function `planOccurrences(rule, now)` decides which monthly occurrences are due or too old. `RecurringSchedulerService` books each due occurrence once — insert a linked row, move the balance through `LedgerService`, roll back on ledger failure — and records progress in a forward-only per-rule marker `lastPeriod`. The bot loses `processRecurring` and its deployment goes to `replicas: 0`.

**Tech Stack:** NestJS 10, Mongoose 8 (api) / 7 (repo), `@nestjs/schedule`, Jest + ts-jest. api uses **pnpm**, repo uses **npm**.

**Spec:** `docs/superpowers/specs/2026-09-24-recurring-scheduler-design.md`

---

## Before you start — facts about this codebase

- **Three services, one MongoDB.** `api/` (NestJS REST, the web's backend), `repo/` (the retiring Telegram bot), `web/` (Angular — **not touched** by this plan). The `recurrings` and `transactions` collections are shared, so a schema field added in one package must be mirrored in the other.
- **`TransactionType` values are legacy Russian strings**: `INCOME = 'Доход'`, `EXPENSE = 'Расход'`. Always compare through the enum; the English words are *not* valid values.
- **Expenses are stored negative, income positive.** Recurring rules store the amount unsigned (web-created) or possibly signed (legacy); always `Math.abs()` and sign by type.
- **`LedgerService.apply(delta, reason, name?, id?)` is the only code in `api/` that moves the balance.** `delta` is signed.
- **`NOT_DELETED` = `{ deletedAt: null }`** from `api/src/shared/schemas/transfer-kind.ts`. Soft-delete `$unset`s `recurringId`/`recurringPeriod`.
- **The partial unique index** `(userId, recurringId, recurringPeriod)` on transactions makes a second booking of the same occurrence fail with Mongo error code `11000`.
- **`@nestjs/schedule` is ESM-only and Jest in `api/` does not transform it.** Any api spec that imports a file using `@Cron` must `jest.mock('@nestjs/schedule', ...)` (see `api/src/ingestion/ingestion.service.spec.ts`). This plan's spec uses a stub that records the cron expression.
- **The repository is public.** Never put real names, account numbers, emails or transaction ids in code, tests or commit messages. Use generic names: `loan`, `salary`, `rent`.
- **Git:** `git add <explicit paths>` only — never `git add -A` or `git add .`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Do not push.**
- **Record the baseline first** (Task 0). Expected counts below assume api **25 suites / 249 tests** and repo **12 suites / 90 tests**; if your baseline differs, the *deltas* per task are what must hold.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/shared/schemas/recurring.schema.ts` | modify | + `lastPeriod?: string` |
| `api/src/shared/schemas/recurring.schema.spec.ts` | create | pins `lastPeriod` |
| `repo/src/mongodb/schemas/recurring.schemas.ts` | modify | + `lastPeriod?: string` (mirror) |
| `repo/src/mongodb/schemas/recurring.schemas.spec.ts` | create | pins the mirror |
| `api/src/recurring/due-occurrences.ts` | create | pure: which occurrences are due / too old |
| `api/src/recurring/due-occurrences.spec.ts` | create | 10 cases incl. the Sep 2026 outage |
| `api/src/recurring/recurring-scheduler.service.ts` | create | `bookOccurrence`, `sweep`, hourly `@Cron` |
| `api/src/recurring/recurring-scheduler.service.spec.ts` | create | booking, sweep, wiring |
| `api/src/recurring/recurring.module.ts` | modify | register the service; import `LedgerModule` + `Transaction` model |
| `repo/src/service/recurring.service.ts` | modify | delete `processRecurring` and helpers |
| `repo/src/service/recurring.service.spec.ts` | replace | one test: the bot no longer books |
| `repo/src/service/transaction.service.ts` | modify | delete orphaned `findOneByRecurringPeriod` |
| `repo/src/service/transaction.service.spec.ts` | modify | delete its test |
| `repo/k8s/deployment.yaml` | modify | `replicas: 0` + warning comment |
| `README.md` | modify | three rows describing where recurring runs |

---

### Task 0: Baseline

- [ ] **Step 1: Record the test baseline**

```bash
cd api && pnpm test 2>&1 | tail -5
cd ../repo && npm test 2>&1 | tail -5
cd .. && git status --short
```

Expected: api `Test Suites: 25 passed, 25 total` / `Tests: 249 passed, 249 total`; repo `12 passed` / `90 passed`; clean tree. Write the numbers down.

---

### Task 1: `lastPeriod` on both recurring schemas

**Files:**
- Modify: `api/src/shared/schemas/recurring.schema.ts`
- Create: `api/src/shared/schemas/recurring.schema.spec.ts`
- Modify: `repo/src/mongodb/schemas/recurring.schemas.ts`
- Create: `repo/src/mongodb/schemas/recurring.schemas.spec.ts`

- [ ] **Step 1: Write the failing api test**

Create `api/src/shared/schemas/recurring.schema.spec.ts`:

```ts
import { RecurringSchema } from './recurring.schema';

describe('RecurringSchema', () => {
  // The api's hourly sweep records the last month each rule has handled here.
  // Row existence cannot serve as that marker: soft-delete $unsets the
  // recurring link, so a deleted recurring row would be booked again every hour.
  it('declares lastPeriod as an optional string', () => {
    const path = RecurringSchema.path('lastPeriod');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    expect(path.isRequired).toBeFalsy();
  });
});
```

- [ ] **Step 2: Write the failing repo test**

Create `repo/src/mongodb/schemas/recurring.schemas.spec.ts`:

```ts
import { RecurringSchema } from './recurring.schemas';

describe('RecurringSchema (bot mirror)', () => {
  // Same collection as the api's schema; a field in one and not the other is a bug.
  it('declares lastPeriod as an optional string', () => {
    const path = RecurringSchema.path('lastPeriod');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    expect(path.isRequired).toBeFalsy();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd api && pnpm test -- recurring.schema 2>&1 | tail -8
cd ../repo && npm test -- recurring.schemas 2>&1 | tail -8
```

Expected: both FAIL on `expect(path).toBeDefined()` (received `undefined`).

- [ ] **Step 4: Add the field to the api schema**

In `api/src/shared/schemas/recurring.schema.ts`, directly after the `lastExecutedAt` line:

```ts
  @Prop() lastExecutedAt: Date;

  /**
   * The last occurrence handled — booked, found already satisfied, or skipped
   * as too old — as 'YYYY-MM'. Only ever moves forward. Deleting a transaction
   * never touches it, so a deleted recurring row is never booked again.
   */
  @Prop() lastPeriod?: string;
}
```

- [ ] **Step 5: Add the mirror to the repo schema**

In `repo/src/mongodb/schemas/recurring.schemas.ts`, directly after the `lastExecutedAt` property:

```ts
  @Prop()
  lastExecutedAt: Date;

  /**
   * Mirror of api/src/shared/schemas/recurring.schema.ts — same collection.
   * Written only by the api's recurring sweep: the last occurrence handled, as
   * 'YYYY-MM'. Only ever moves forward.
   */
  @Prop()
  lastPeriod?: string;
}
```

- [ ] **Step 6: Run both to verify they pass, then the full suites**

```bash
cd api && pnpm test -- recurring.schema 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
cd ../repo && npm test -- recurring.schemas 2>&1 | tail -5 && npm test 2>&1 | tail -5
```

Expected: api **26 suites / 250 tests**, repo **13 suites / 91 tests**, all passing.

- [ ] **Step 7: Commit**

```bash
git add api/src/shared/schemas/recurring.schema.ts api/src/shared/schemas/recurring.schema.spec.ts repo/src/mongodb/schemas/recurring.schemas.ts repo/src/mongodb/schemas/recurring.schemas.spec.ts
git commit -F- <<'EOF'
feat(api,bot): lastPeriod marks the last month a recurring rule handled

The api's recurring sweep needs a forward-only per-rule marker; row
existence cannot serve because soft-delete unsets the recurring link.
Mirrored in the bot's schema — same collection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `planOccurrences` — which occurrences are due

**Files:**
- Create: `api/src/recurring/due-occurrences.ts`
- Test: `api/src/recurring/due-occurrences.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/recurring/due-occurrences.spec.ts`:

```ts
import { planOccurrences, SchedulableRule } from './due-occurrences';

const at = (iso: string) => new Date(iso);

/** Unless a case says otherwise, the rule was created 2026-01-01. */
const rule = (overrides: Partial<SchedulableRule> = {}): SchedulableRule => ({
  dayOfMonth: 20,
  createdAt: at('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('planOccurrences', () => {
  it('books the occurrence missed in the Sep 2026 outage (legacy rule last run by the bot)', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 20, lastExecutedAt: at('2026-08-20T12:00:05Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.due).toEqual([{ period: '2026-09', dueAt: at('2026-09-20T12:00:00Z') }]);
    expect(plan.tooOld).toEqual([]);
  });

  it('is due from 12:00 UTC (08:00 Santo Domingo) on its day, not before', () => {
    const r = rule({ dayOfMonth: 25, lastPeriod: '2026-08' });
    expect(planOccurrences(r, at('2026-09-25T11:30:00Z')).due).toEqual([]);
    expect(planOccurrences(r, at('2026-09-25T12:30:00Z')).due).toEqual([
      { period: '2026-09', dueAt: at('2026-09-25T12:00:00Z') },
    ]);
  });

  it('catches up across a month end', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 28, lastPeriod: '2026-08' }), at('2026-10-02T09:00:00Z'));
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
    expect(plan.tooOld).toEqual([]);
  });

  it('skips, rather than books, occurrences older than 31 days', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 10, lastPeriod: '2026-06' }), at('2026-09-25T15:00:00Z'));
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-07', '2026-08']);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
  });

  it('never books an occurrence due before the rule was created', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 24, createdAt: at('2026-09-24T15:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan).toEqual({ due: [], tooOld: [] });
  });

  it('books nothing for a month already handled', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 20, lastPeriod: '2026-09' }), at('2026-09-25T15:00:00Z'));
    expect(plan).toEqual({ due: [], tooOld: [] });
  });

  it('lets lastPeriod win over lastExecutedAt', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 20, lastPeriod: '2026-09', lastExecutedAt: at('2026-08-20T12:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.due).toEqual([]);
  });

  it('bounds a never-run rule by its creation month and the window', () => {
    const plan = planOccurrences(
      rule({ dayOfMonth: 5, createdAt: at('2026-07-01T00:00:00Z') }),
      at('2026-09-25T15:00:00Z'),
    );
    expect(plan.tooOld.map((o) => o.period)).toEqual(['2026-07', '2026-08']);
    expect(plan.due.map((o) => o.period)).toEqual(['2026-09']);
  });

  it('crosses a year boundary', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 15, lastPeriod: '2026-12' }), at('2027-01-20T00:00:00Z'));
    expect(plan.due).toEqual([{ period: '2027-01', dueAt: at('2027-01-15T12:00:00Z') }]);
  });

  it('includes both window edges: exactly 31 days back and exactly now', () => {
    const plan = planOccurrences(rule({ dayOfMonth: 26, lastPeriod: '2026-07' }), at('2026-09-26T12:00:00Z'));
    expect(plan.due.map((o) => o.period)).toEqual(['2026-08', '2026-09']);
    expect(plan.tooOld).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd api && pnpm test -- due-occurrences 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './due-occurrences'`.

- [ ] **Step 3: Implement**

Create `api/src/recurring/due-occurrences.ts`:

```ts
import { periodKey } from '../ingestion/reconciliation.service';

/** How far back a missed occurrence is still booked automatically. */
export const LOOKBACK_DAYS = 31;

/** 08:00 America/Santo_Domingo — UTC−4 all year; the Dominican Republic has no DST. */
export const DUE_HOUR_UTC = 12;

const DAY_MS = 86_400_000;

export interface SchedulableRule {
  /** 1..28 (schema bound), so the day exists in every month. */
  dayOfMonth: number;
  /** From the rule's ObjectId — NOT the createdAt field, which loads as "now" on legacy rules. */
  createdAt: Date;
  /** Last month handled, 'YYYY-MM'. */
  lastPeriod?: string;
  lastExecutedAt?: Date;
}

export interface Occurrence {
  period: string;
  dueAt: Date;
}

/**
 * Which of a rule's monthly occurrences are due now, and which were missed so
 * long ago that they are skipped instead of booked. Pure: no clock, no database.
 *
 * "Handled through" is lastPeriod, or — for legacy rules the bot ran — the
 * month of lastExecutedAt: the bot always ran on the due day at 12:00 UTC, so
 * that month is the month of the occurrence it handled.
 */
export function planOccurrences(rule: SchedulableRule, now: Date): { due: Occurrence[]; tooOld: Occurrence[] } {
  const due: Occurrence[] = [];
  const tooOld: Occurrence[] = [];

  const handled =
    rule.lastPeriod ?? (rule.lastExecutedAt ? periodKey(new Date(rule.lastExecutedAt)) : undefined);

  // Months are counted as year * 12 + zero-based month, so month arithmetic
  // can never loop on an un-normalised month number across a year boundary.
  let first: number;
  if (handled) {
    const [y, m] = handled.split('-').map(Number);
    first = y * 12 + m; // m is 1-based: as a zero-based index it is already the month after
  } else {
    first = rule.createdAt.getUTCFullYear() * 12 + rule.createdAt.getUTCMonth();
  }
  const last = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const windowStart = now.getTime() - LOOKBACK_DAYS * DAY_MS;

  for (let index = first; index <= last; index++) {
    const dueAt = new Date(Date.UTC(Math.floor(index / 12), index % 12, rule.dayOfMonth, DUE_HOUR_UTC));
    if (dueAt.getTime() > now.getTime()) continue; // not yet due
    if (dueAt.getTime() < rule.createdAt.getTime()) continue; // before the rule existed

    const occurrence = { period: periodKey(dueAt), dueAt };
    if (dueAt.getTime() < windowStart) tooOld.push(occurrence);
    else due.push(occurrence);
  }

  return { due, tooOld };
}
```

- [ ] **Step 4: Run to verify it passes, then the full api suite**

```bash
cd api && pnpm test -- due-occurrences 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 10 passed in the file; api **27 suites / 260 tests**.

- [ ] **Step 5: Commit**

```bash
git add api/src/recurring/due-occurrences.ts api/src/recurring/due-occurrences.spec.ts
git commit -F- <<'EOF'
feat(api): planOccurrences decides which recurring occurrences are due

Pure function: occurrences at 08:00 Santo Domingo on the rule's day, after
the rule's last handled month and its creation, due when past and within
31 days, too old (skipped, never booked) beyond that.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `RecurringSchedulerService.bookOccurrence` — book one occurrence exactly once

**Files:**
- Create: `api/src/recurring/recurring-scheduler.service.ts`
- Test: `api/src/recurring/recurring-scheduler.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/recurring/recurring-scheduler.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';

// @nestjs/schedule ships ESM-only and Jest here does not transform it (see
// ingestion.service.spec.ts). This stub also records every cron expression it
// is given, so the schedule itself can be asserted.
jest.mock('@nestjs/schedule', () => {
  const cronExpressions: string[] = [];
  return {
    __cronExpressions: cronExpressions,
    Cron: (expression: string) => {
      cronExpressions.push(expression);
      return () => undefined;
    },
  };
});

import { RecurringSchedulerService } from './recurring-scheduler.service';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { LedgerService } from '../shared/ledger/ledger.service';

/** Rules are "created" 2026-01-01 unless a test says otherwise: the ObjectId carries the time. */
const CREATED_HEX = Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(16);
let idSeq = 0;
const ruleId = () => new Types.ObjectId(CREATED_HEX + String(++idSeq).padStart(16, '0'));

function makeRule(overrides: Record<string, unknown> = {}): any {
  return {
    _id: ruleId(),
    userId: 1,
    userName: 'web',
    transactionName: 'loan',
    transactionType: TransactionType.EXPENSE,
    amount: 5000,
    category: 'housing',
    dayOfMonth: 20,
    active: true,
    ...overrides,
  };
}

const NOW = new Date('2026-09-25T15:00:00Z');
const SEP = { period: '2026-09', dueAt: new Date('2026-09-20T12:00:00Z') };

describe('RecurringSchedulerService', () => {
  let service: RecurringSchedulerService;
  let recurringModel: { find: jest.Mock; updateOne: jest.Mock };
  let txModel: { findOne: jest.Mock; create: jest.Mock; deleteOne: jest.Mock };
  let ledger: { apply: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    recurringModel = { find: jest.fn().mockResolvedValue([]), updateOne: jest.fn().mockResolvedValue({}) };
    txModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'tx1' }),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    ledger = { apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }) };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringSchedulerService,
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();
    service = module.get(RecurringSchedulerService);
  });

  afterEach(() => jest.restoreAllMocks());

  /** The exact arguments of a forward-only "mark handled" update. */
  const markedHandled = (rule: any, period: string, at: Date = NOW) => [
    { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
    { $set: { lastPeriod: period, lastExecutedAt: at } },
  ];

  describe('bookOccurrence', () => {
    it('books an expense once: linked row, negative amount, one ledger movement, marker forward', async () => {
      const rule = makeRule();
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('booked');
      expect(txModel.create).toHaveBeenCalledWith({
        userId: 1,
        userName: 'web',
        transactionName: 'loan',
        transactionType: TransactionType.EXPENSE,
        amount: -5000,
        timestamp: SEP.dueAt,
        category: 'housing',
        source: 'recurring',
        recurringId: String(rule._id),
        recurringPeriod: '2026-09',
      });
      expect(ledger.apply).toHaveBeenCalledTimes(1);
      expect(ledger.apply).toHaveBeenCalledWith(-5000, 'recurring', 'loan', 'tx1');
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('books income as a positive amount', async () => {
      const rule = makeRule({ transactionType: TransactionType.INCOME, amount: 45000, transactionName: 'salary' });
      await service.bookOccurrence(rule, SEP, NOW);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 45000 }));
      expect(ledger.apply).toHaveBeenCalledWith(45000, 'recurring', 'salary', 'tx1');
    });

    it('signs by type, not by the stored sign: a legacy expense stored negative stays an expense', async () => {
      await service.bookOccurrence(makeRule({ amount: -5000 }), SEP, NOW);
      expect(ledger.apply).toHaveBeenCalledWith(-5000, 'recurring', 'loan', 'tx1');
    });

    it('fails closed on an unknown transactionType: nothing written, nothing moved', async () => {
      // The English word is exactly the mistake to guard against: the enum's values are 'Доход'/'Расход'.
      const rule = makeRule({ transactionType: 'income' });
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('failed');
      expect(txModel.findOne).not.toHaveBeenCalled();
      expect(txModel.create).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });

    it('treats a live linked row as already satisfied: no second row, no money', async () => {
      const rule = makeRule();
      txModel.findOne.mockResolvedValue({ _id: 'emailRow' });
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('satisfied');
      expect(txModel.findOne).toHaveBeenCalledWith({
        userId: 1,
        recurringId: String(rule._id),
        recurringPeriod: '2026-09',
        deletedAt: null,
      });
      expect(txModel.create).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('treats a duplicate key on insert as satisfied by another writer: no money', async () => {
      const rule = makeRule();
      txModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      await expect(service.bookOccurrence(rule, SEP, NOW)).resolves.toBe('satisfied');
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).toHaveBeenCalledWith(...markedHandled(rule, '2026-09'));
    });

    it('propagates any other insert error without moving money or the marker', async () => {
      txModel.create.mockRejectedValue(new Error('connection reset'));
      await expect(service.bookOccurrence(makeRule(), SEP, NOW)).rejects.toThrow('connection reset');
      expect(ledger.apply).not.toHaveBeenCalled();
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });

    it('rolls the row back when the ledger fails and leaves the marker for the next hour', async () => {
      ledger.apply.mockRejectedValue(new Error('balance write failed'));
      await expect(service.bookOccurrence(makeRule(), SEP, NOW)).resolves.toBe('failed');
      expect(txModel.deleteOne).toHaveBeenCalledWith({ _id: 'tx1' });
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
```

(`logSpy`, `warnSpy` and `errorSpy` silence the logger here; Task 4's tests read them.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd api && pnpm test -- recurring-scheduler 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './recurring-scheduler.service'`.

- [ ] **Step 3: Implement**

Create `api/src/recurring/recurring-scheduler.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { Occurrence } from './due-occurrences';

export type BookingOutcome = 'booked' | 'satisfied' | 'failed';

/**
 * Books recurring rules into transactions. Replaces the bot's daily 08:00 cron,
 * which booked only the rules due that exact day and never caught up: the bot
 * was down Sep 17–24 2026 and every rule due that week was silently skipped.
 */
@Injectable()
export class RecurringSchedulerService {
  private readonly logger = new Logger(RecurringSchedulerService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Books one occurrence of one rule — at most once, whoever else is writing.
   * 'satisfied' means it was already recorded (by the bank email, or by another
   * api pod during a rollout) and no money moves. Unexpected database errors
   * propagate to the caller.
   */
  async bookOccurrence(rule: Recurring, occurrence: Occurrence, now: Date): Promise<BookingOutcome> {
    const recurringId = String(rule._id);

    // MUST go through the enum: its values are the legacy strings 'Доход'/'Расход'.
    // Sign by type, never by the stored sign. Anything else fails closed.
    const magnitude = Math.abs(rule.amount);
    let signed: number;
    if (rule.transactionType === TransactionType.EXPENSE) signed = -magnitude;
    else if (rule.transactionType === TransactionType.INCOME) signed = magnitude;
    else {
      this.logger.error(`Recurring ${recurringId} has unknown transactionType "${rule.transactionType}"; not booked`);
      return 'failed';
    }

    const existing = await this.txModel.findOne({
      userId: this.userId,
      recurringId,
      recurringPeriod: occurrence.period,
      ...NOT_DELETED,
    });
    if (existing) {
      await this.markHandled(rule, occurrence.period, now);
      return 'satisfied';
    }

    let created: { _id: unknown };
    try {
      created = await this.txModel.create({
        userId: this.userId,
        userName: rule.userName,
        transactionName: rule.transactionName,
        transactionType: rule.transactionType,
        amount: signed,
        timestamp: occurrence.dueAt,
        category: rule.category,
        source: 'recurring',
        recurringId,
        recurringPeriod: occurrence.period,
      });
    } catch (err: any) {
      // The partial unique index on (userId, recurringId, recurringPeriod):
      // another writer recorded this occurrence between our lookup and insert.
      if (err?.code === 11000) {
        await this.markHandled(rule, occurrence.period, now);
        return 'satisfied';
      }
      throw err;
    }

    const id = String(created._id);
    try {
      await this.ledger.apply(signed, 'recurring', rule.transactionName, id);
    } catch (err) {
      // A linked row whose money never moved would be found as 'satisfied' next
      // hour and never retried. Remove it — created milliseconds ago, no
      // sourceMessageId, never returned to a caller — so the next sweep redoes both.
      try {
        await this.txModel.deleteOne({ _id: created._id });
      } catch (rollbackErr) {
        this.logger.error(`Rollback of ${id} failed; row is orphaned`, String(rollbackErr));
      }
      this.logger.error(`Ledger failed booking recurring ${recurringId} for ${occurrence.period}; rolled back`, String(err));
      return 'failed';
    }

    await this.markHandled(rule, occurrence.period, now);
    return 'booked';
  }

  /** Forward-only: lastPeriod never moves back, whatever order writers land in. */
  private async markHandled(rule: Recurring, period: string, now: Date): Promise<void> {
    await this.recurringModel.updateOne(
      { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
      { $set: { lastPeriod: period, lastExecutedAt: now } },
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes, then the full api suite**

```bash
cd api && pnpm test -- recurring-scheduler 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 8 passed in the file; api **28 suites / 268 tests**.

- [ ] **Step 5: Commit**

```bash
git add api/src/recurring/recurring-scheduler.service.ts api/src/recurring/recurring-scheduler.service.spec.ts
git commit -F- <<'EOF'
feat(api): book one recurring occurrence exactly once

Linked row first, then the ledger; a live linked row or a unique-index
clash means another writer booked it and no money moves; a ledger failure
removes the row and leaves the marker so the next run retries. Signs by
type through the enum and fails closed on anything else.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The hourly sweep, and wiring it into the module

**Files:**
- Modify: `api/src/recurring/recurring-scheduler.service.ts`
- Modify: `api/src/recurring/recurring.module.ts`
- Test: `api/src/recurring/recurring-scheduler.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `api/src/recurring/recurring-scheduler.service.spec.ts`, add two imports below the existing ones:

```ts
import { RecurringModule } from './recurring.module';
import { LedgerModule } from '../shared/ledger/ledger.module';
```

Then add these two `describe` blocks inside the top-level `describe('RecurringSchedulerService', ...)`, after the `bookOccurrence` block:

```ts
  describe('wiring', () => {
    it('runs hourly at minute 5', () => {
      const { __cronExpressions } = jest.requireMock('@nestjs/schedule');
      expect(__cronExpressions).toContain('5 * * * *');
    });

    it('is a provider of RecurringModule, which imports the ledger', () => {
      expect(Reflect.getMetadata('providers', RecurringModule)).toContain(RecurringSchedulerService);
      expect(Reflect.getMetadata('imports', RecurringModule)).toContain(LedgerModule);
    });
  });

  describe('sweep', () => {
    const summary = (booked: number, satisfied: number, skipped: number, failed: number) =>
      `Recurring sweep: booked ${booked}, satisfied ${satisfied}, skipped ${skipped} (older than 31 days), failed ${failed}`;

    it('reads only the owner’s active rules', async () => {
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledWith({ userId: 1, active: true });
    });

    it('books the September occurrence the bot missed, dated on its day, and reports it', async () => {
      recurringModel.find.mockResolvedValue([makeRule({ dayOfMonth: 20, lastExecutedAt: new Date('2026-08-20T12:00:05Z') })]);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: new Date('2026-09-20T12:00:00Z'),
          recurringPeriod: '2026-09',
          amount: -5000,
          source: 'recurring',
        }),
      );
      expect(ledger.apply).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 0, 0));
    });

    it('stops a rule at its first failed occurrence so the marker never passes it', async () => {
      // Two due occurrences (Aug 26 and Sep 26); the older one's ledger write fails.
      recurringModel.find.mockResolvedValue([makeRule({ dayOfMonth: 26, lastPeriod: '2026-07' })]);
      ledger.apply.mockRejectedValueOnce(new Error('balance write failed'));
      await service.sweep(new Date('2026-09-26T12:00:00Z'));
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ recurringPeriod: '2026-08' }));
      expect(txModel.deleteOne).toHaveBeenCalledWith({ _id: 'tx1' });
      expect(recurringModel.updateOne).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(summary(0, 0, 0, 1));
    });

    it('keeps going when one rule throws', async () => {
      const rent = makeRule({ transactionName: 'rent', lastPeriod: '2026-08' });
      const loan = makeRule({ transactionName: 'loan', lastPeriod: '2026-08' });
      recurringModel.find.mockResolvedValue([rent, loan]);
      txModel.findOne.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(null);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ transactionName: 'loan' }));
      expect(errorSpy).toHaveBeenCalledWith(`Recurring ${String(rent._id)} failed`, expect.any(String));
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 0, 1));
    });

    it('skips occurrences older than 31 days: marks the newest skipped month, books the rest, warns once', async () => {
      const rule = makeRule({ dayOfMonth: 10, lastPeriod: '2026-06' });
      recurringModel.find.mockResolvedValue([rule]);
      await service.sweep(NOW);
      expect(recurringModel.updateOne).toHaveBeenNthCalledWith(1, ...markedHandled(rule, '2026-08'));
      expect(recurringModel.updateOne).toHaveBeenNthCalledWith(2, ...markedHandled(rule, '2026-09'));
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ recurringPeriod: '2026-09' }));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2026-07, 2026-08'));
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 2, 0));
    });

    it('does not start a second sweep while one is in flight', async () => {
      let release!: (rules: unknown[]) => void;
      recurringModel.find.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      const first = service.sweep(NOW);
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledTimes(1);
      release([]);
      await first;
    });

    it('logs a failed rule query instead of throwing, and releases the guard', async () => {
      recurringModel.find.mockRejectedValueOnce(new Error('mongo down'));
      await expect(service.sweep(NOW)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('Recurring sweep failed', expect.any(String));
      await service.sweep(NOW);
      expect(recurringModel.find).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd api && pnpm test -- recurring-scheduler 2>&1 | tail -12
```

Expected: FAIL — TypeScript error `Property 'sweep' does not exist on type 'RecurringSchedulerService'` (the whole file fails to compile, including the Task 3 tests; that is expected until Step 3).

- [ ] **Step 3: Implement the sweep**

In `api/src/recurring/recurring-scheduler.service.ts`:

Replace the imports block at the top with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { LOOKBACK_DAYS, Occurrence, planOccurrences } from './due-occurrences';

export type BookingOutcome = 'booked' | 'satisfied' | 'failed';

interface Tally {
  booked: number;
  satisfied: number;
  skipped: number;
  failed: number;
}
```

(Keep the class doc comment; the `export type BookingOutcome` line now appears once, in this block — delete the old one.)

Add a field below `private readonly userId ...`:

```ts
  private running = false;
```

Add these three methods inside the class, directly after the constructor:

```ts
  /** Hourly at minute 5 — between the ingestion polls, which run every 10 minutes from :00. */
  @Cron('5 * * * *', { waitForCompletion: true })
  async poll(): Promise<void> {
    await this.sweep(new Date());
  }

  /**
   * Books every occurrence that is due, not yet handled, and at most
   * LOOKBACK_DAYS old. On-time booking and catch-up are the same path, so the
   * catch-up logic runs every day, not only after an outage.
   */
  async sweep(now: Date): Promise<void> {
    if (this.running) {
      this.logger.warn('Recurring sweep skipped: previous run still in flight');
      return;
    }
    this.running = true;
    const tally: Tally = { booked: 0, satisfied: 0, skipped: 0, failed: 0 };
    try {
      const rules = await this.recurringModel.find({ userId: this.userId, active: true });
      for (const rule of rules) {
        try {
          await this.processRule(rule, now, tally);
        } catch (err) {
          tally.failed++;
          this.logger.error(`Recurring ${String(rule._id)} failed`, err instanceof Error ? err.stack : String(err));
        }
      }
      this.logger.log(
        `Recurring sweep: booked ${tally.booked}, satisfied ${tally.satisfied}, ` +
          `skipped ${tally.skipped} (older than ${LOOKBACK_DAYS} days), failed ${tally.failed}`,
      );
    } catch (err) {
      this.logger.error('Recurring sweep failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processRule(rule: Recurring, now: Date, tally: Tally): Promise<void> {
    const plan = planOccurrences(
      {
        dayOfMonth: rule.dayOfMonth,
        // The ObjectId, not the createdAt field: createdAt defaults to "now" on
        // legacy rules stored without it, which would block their catch-up.
        createdAt: (rule._id as Types.ObjectId).getTimestamp(),
        lastPeriod: rule.lastPeriod,
        lastExecutedAt: rule.lastExecutedAt,
      },
      now,
    );

    if (plan.tooOld.length > 0) {
      const periods = plan.tooOld.map((o) => o.period);
      await this.markHandled(rule, periods[periods.length - 1], now);
      tally.skipped += periods.length;
      this.logger.warn(
        `Recurring ${String(rule._id)} "${rule.transactionName}": not booking ${periods.join(', ')}, ` +
          `older than ${LOOKBACK_DAYS} days`,
      );
    }

    for (const occurrence of plan.due) {
      const outcome = await this.bookOccurrence(rule, occurrence, now);
      tally[outcome]++;
      // lastPeriod only moves forward: booking a newer month after a failure
      // would carry the marker past the failed one, and it would never retry.
      if (outcome === 'failed') break;
    }
  }
```

- [ ] **Step 4: Register the service in the module**

Replace the whole of `api/src/recurring/recurring.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import { RecurringSchedulerService } from './recurring-scheduler.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recurring.name, schema: RecurringSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    CategoriesModule,
    LedgerModule,
  ],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringSchedulerService],
})
export class RecurringModule {}
```

(`ScheduleModule.forRoot()` is already imported in `api/src/app.module.ts`; do not add it again.)

- [ ] **Step 5: Run to verify it passes, the full suite, and the build**

```bash
cd api && pnpm test -- recurring-scheduler 2>&1 | tail -5 && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -5
```

Expected: 17 passed in the file; api **28 suites / 277 tests**; build exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/recurring/recurring-scheduler.service.ts api/src/recurring/recurring-scheduler.service.spec.ts api/src/recurring/recurring.module.ts
git commit -F- <<'EOF'
feat(api): hourly recurring sweep with catch-up

Every hour at :05 the api books every recurring occurrence that is due,
not yet handled and at most 31 days old; older ones are skipped with one
warning. A rule stops at its first failure so the forward-only marker can
never pass an unbooked month. One summary line per run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The bot stops booking

**Files:**
- Replace: `repo/src/service/recurring.service.spec.ts`
- Modify: `repo/src/service/recurring.service.ts`
- Modify: `repo/src/service/transaction.service.ts`
- Modify: `repo/src/service/transaction.service.spec.ts`

- [ ] **Step 1: Replace the bot's recurring spec with the failing pin test**

Replace the whole of `repo/src/service/recurring.service.spec.ts` with:

```ts
import { RecurringService } from './recurring.service';

describe('RecurringService (bot)', () => {
  // Recurring bookings moved to the api's hourly sweep on 2026-09-24
  // (api/src/recurring/recurring-scheduler.service.ts). The bot is scaled to
  // zero; if it is ever started by mistake it must not book anything.
  it('no longer books recurring transactions', () => {
    expect((RecurringService.prototype as any).processRecurring).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd repo && npm test -- recurring.service 2>&1 | tail -8
```

Expected: FAIL — `expect(received).toBeUndefined()`, received `[Function processRecurring]`.

- [ ] **Step 3: Remove the cron from the bot**

Replace the whole of `repo/src/service/recurring.service.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurring } from '../mongodb/schemas/recurring.schemas';
import { TransactionType } from '../type/enum/transactionType.enam';

/**
 * Recurring rules as the bot manages them. Booking moved to the api's hourly
 * sweep (api/src/recurring/recurring-scheduler.service.ts) on 2026-09-24; the
 * bot is scaled to zero and must never book on its own again.
 */
@Injectable()
export class RecurringService {
  constructor(@InjectModel('Recurring') private readonly recurringModel: Model<Recurring>) {}

  async createRecurring(
    userId: number,
    userName: string,
    transactionName: string,
    transactionType: TransactionType,
    amount: number,
    dayOfMonth: number,
    category: string = 'other',
  ): Promise<Recurring> {
    return this.recurringModel.create({
      userId,
      userName,
      transactionName,
      transactionType,
      amount,
      dayOfMonth,
      category,
      active: true,
    });
  }

  async listRecurring(userId: number): Promise<Recurring[]> {
    return this.recurringModel.find({ userId, active: true }).exec();
  }

  async deleteRecurring(userId: number, recurringId: string): Promise<void> {
    await this.recurringModel.findOneAndUpdate({ _id: recurringId, userId }, { active: false }).exec();
  }
}
```

(Note: the file currently starts with a UTF-8 BOM before `import`; the replacement drops it, which is fine.)

- [ ] **Step 4: Delete the orphaned lookup and its test**

In `repo/src/service/transaction.service.ts`, delete this whole block — the JSDoc and the method, and the blank line after it:

```ts
  /**
   * Finds an ingested transaction already recorded for a given recurring rule
   * and period. Used to skip firing a recurring rule when the bank email has
   * already recorded the real-world payment it predicts.
   *
   * Queries the explicit recurringPeriod stamp rather than a timestamp range:
   * a payment posted near a month boundary can carry a timestamp in a
   * different calendar month than the occurrence it actually satisfies, so a
   * date-range lookup could miss it and record the same payment twice.
   */
  async findOneByRecurringPeriod(userId: number, recurringId: string, period: string) {
    return this.transactionModel.findOne({ userId, recurringId, recurringPeriod: period, ...NOT_DELETED }).exec();
  }
```

In `repo/src/service/transaction.service.spec.ts`, delete this whole block and the blank line after it:

```ts
  describe('findOneByRecurringPeriod', () => {
    it('reads live rows only', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.findOneByRecurringPeriod(1, 'rule-1', '2026-09');

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, recurringId: 'rule-1', recurringPeriod: '2026-09', ...NOT_DELETED }),
      );
    });
  });
```

If `NOT_DELETED` is no longer used anywhere else in either file after the deletions, remove its import from that file; otherwise leave the import alone:

```bash
grep -c "NOT_DELETED" repo/src/service/transaction.service.ts repo/src/service/transaction.service.spec.ts
```

(Each count includes the import line; a count of 1 means only the import is left.)

- [ ] **Step 5: Verify nothing references the removed code, then run the suite and build**

```bash
git grep -n "processRecurring\|findOneByRecurringPeriod\|currentPeriodKey\|isSameMonth" -- repo api
cd repo && npm test -- recurring.service 2>&1 | tail -5 && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -5
```

Expected: the `git grep` prints **only** the `processRecurring` line of the new pin test in `repo/src/service/recurring.service.spec.ts`; repo **13 suites / 81 tests** (the old recurring spec had 10 tests, now 1; one transaction-service test removed); build exits 0.

- [ ] **Step 6: Commit**

```bash
git add repo/src/service/recurring.service.ts repo/src/service/recurring.service.spec.ts repo/src/service/transaction.service.ts repo/src/service/transaction.service.spec.ts
git commit -F- <<'EOF'
refactor(bot): the bot no longer books recurring transactions

Booking moved to the api's hourly sweep. processRecurring, its helpers
and the now-unused findOneByRecurringPeriod are removed; a pin test keeps
a mistakenly restarted bot from ever booking again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Scale the bot to zero; README

**Files:**
- Modify: `repo/k8s/deployment.yaml`
- Modify: `README.md`

- [ ] **Step 1: Set replicas to 0 with the warning**

In `repo/k8s/deployment.yaml`, replace:

```yaml
spec:
  replicas: 1
```

with:

```yaml
spec:
  # RETIRED (2026-09-24). Telegram is no longer used, and recurring bookings
  # moved to the api's hourly sweep, which catches up missed days. Kept at
  # zero replicas rather than deleted: this Argo CD application (path
  # repo/k8s/) also owns namespace.yaml and mongodb-statefulset.yaml.
  # NEVER delete this Argo app or this folder — it would delete the namespace
  # and the database the api and web depend on.
  replicas: 0
```

Leave the rest of the file unchanged.

- [ ] **Step 2: Update the three README rows**

In `README.md`, make exactly these three replacements.

Overview table — replace:

```markdown
| **Telegram bot** | NestJS + Telegraf + MongoDB | Transaction entry, budgets, recurring items, CSV export, AI insights |
```

with:

```markdown
| **Telegram bot** | NestJS + Telegraf + MongoDB | Retired (scaled to zero, 2026-09). Recurring bookings now run in the API |
```

Bot features table — replace:

```markdown
| **Recurring** | Scheduled recurring transactions, processed daily at 08:00 |
```

with:

```markdown
| **Recurring** | Moved to the API (2026-09): booked hourly, catching up missed days |
```

Web dashboard table — replace:

```markdown
| **Recurring** | Upcoming next billing and what was billed this month |
```

with:

```markdown
| **Recurring** | Create rules; upcoming billing and what was billed this month. The API books each rule hourly on its day and catches up days missed within 31 days |
```

- [ ] **Step 3: Verify**

```bash
grep -n "replicas" repo/k8s/deployment.yaml
grep -nE "Retired \(scaled|Moved to the API|catches up days missed" README.md
```

Expected: `replicas: 0` (one match); three README matches.

- [ ] **Step 4: Commit**

```bash
git add repo/k8s/deployment.yaml README.md
git commit -F- <<'EOF'
chore(bot): scale the retired bot to zero

Argo applies this on push. Kept at zero rather than deleted: the same
Argo app owns the namespace and MongoDB.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Final verification (no commit unless something is wrong)

- [ ] **Step 1: Full suites and builds**

```bash
cd api && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd ../repo && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -3
cd .. && git diff --stat HEAD~6 -- web
```

Expected: api **28 / 277**, repo **13 / 81**, both builds exit 0; the `web` diff is empty.

- [ ] **Step 2: Leftovers and privacy**

```bash
git grep -n "processRecurring\|findOneByRecurringPeriod" -- repo api
git log --format=%B -6 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```

Expected: only the pin test line; `6`; clean tree. The controller runs the private-identifier check separately.

---

## After the tasks (controller)

1. Spec review, then code-quality review, of `<base>..HEAD` as usual.
2. Private-identifier gate on the whole tracked tree, then push `main`.
3. Hand the user: Argo scales the bot to zero on its own; run `kubectl -n accounting-bot rollout restart deployment/accounting-api`; after the next :05, `kubectl -n accounting-bot logs deploy/accounting-api --since=2h | grep "Recurring sweep"` should show the Sep 18–24 occurrences booked, and the Recurring page's "last run" updates.
4. Update project memory: the bot is at zero replicas; recurring lives in the api.
