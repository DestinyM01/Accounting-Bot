# Balance Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web can set the balance to the total the user's accounts show (one atomic ledger write, recorded as a manual adjustment), and a new Balance page shows a 90-day chart of daily closing balances and the full history, filterable by kind.

**Architecture:**
- **api:** `LedgerService.setTo` is the atomic absolute set. A pure `daily-closings.ts` does the day-bucketing. `BalanceService` gains `set`, `history` and `daily`, exposed as `PUT /balance`, `GET /balance/history` and `GET /balance/daily`.
- **web:** a standalone `BalanceComponent` (header, inline set form with preview, stepped Chart.js line in theme colours, filter chips, paged list), a nav item, and a link from the Dashboard's balance card.

**Tech Stack:** NestJS 10, Mongoose 8, Jest (api, **pnpm**); Angular 17 standalone components, Chart.js (web, **pnpm**, no test runner).

**Spec:** `docs/superpowers/specs/2026-09-24-balance-page-design.md`

---

## Before you start — facts about this codebase

- **`LedgerService` (`api/src/shared/ledger/ledger.service.ts`) is the only code in `api/` that moves the balance.** Every movement writes a `BalanceHistory` row (`previousBalance`, `newBalance`, `delta`, `reason`, `transactionName`, `transactionId`, `timestamp`). A history-write failure is logged and never undoes the movement.
- **`BalanceChangeReason`** = `'income' | 'expense' | 'delete' | 'manual' | 'recurring'` (`api/src/shared/schemas/balance-history.schema.ts`).
- **Santo Domingo is UTC−4 all year** (no DST): local midnight = 04:00 UTC. Code uses this fixed offset, not a time-zone library, so tests are deterministic anywhere.
- **Query-string values arrive as strings** in Nest controllers (no `ValidationPipe` in this app): parse and clamp them in the service.
- **Web money formatting** is Angular's `currency:'USD':'symbol'` (a `$` sign) everywhere; keep that.
- **Web styles:** shared form classes `.fc-field`, `.fc-input`, `.fc-btn`, `.fc-btn--primary`, `.fc-btn--ghost`, `.fc-error` (from `web/src/styles/_form-controls.scss`), global `.page-wrap` and `.card`. Page stylesheets use **`var(--…)` tokens only** — no hex, rgb or oklch. Tokens available include `--accent`, `--color-accent-ink`, `--income`, `--expense`, `--border`, `--text`, `--text-muted`, `--color-focus`, `--color-surface-hover`, `--radius-pill`, `--space-3xs … --space-2xl`, `--text-xs … --text-2xl`, `--text-page-title`.
- **Chart colours** are read at runtime with `getComputedStyle(document.documentElement).getPropertyValue('--accent')` — never hard-coded (the Dashboard's chart hard-codes hex; do not copy that).
- **Public repository:** no real names, account numbers, email addresses or transaction ids anywhere; tests use generic names (`uber`, `cash not tracked`).
- **Git:** `git add <explicit paths>` only — never `-A` or `.`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Do not push.**
- **Counts:** baseline **api 36 suites / 345 tests**, **repo 13 / 82**. If your baseline differs, the per-task deltas (listed by test name) must hold.
- Run commands with explicit `cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/<dir>"` — the working directory does not persist reliably.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/shared/ledger/ledger.service.ts` (+ spec) | modify | + `setTo(target, note?)` |
| `api/src/shared/schemas/balance-history.schema.ts` (+ new spec) | modify / create | + index `{ userId: 1, timestamp: -1 }` |
| `api/src/balance/daily-closings.ts` (+ spec) | create | pure: `localDay`, `windowStart`, `dailyClosings` |
| `api/src/balance/balance.service.ts` (+ new spec) | modify / create | + `set`, `history`, `daily` |
| `api/src/balance/balance.controller.ts` | modify | + `PUT /`, `GET history`, `GET daily` |
| `api/src/balance/balance.module.ts` | modify | + `LedgerModule`, `BalanceHistory` model |
| `api/src/transactions/transactions.controller.spec.ts` | modify | pin `JwtAuthGuard` on `BalanceController` |
| `web/src/app/core/services/api.models.ts`, `api.service.ts` | modify | types and three calls |
| `web/src/app/pages/balance/balance.component.{ts,html,scss}` | create | the page |
| `web/src/app/app.routes.ts`, `web/src/app/app.component.ts` | modify | route and nav item |
| `web/src/app/pages/dashboard/dashboard.component.{ts,html,scss}` | modify | balance card links to the page |
| `README.md` | modify | page and endpoints |

---

### Task 0: Baseline

- [ ] **Step 1: Record the baseline**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git status --short
```

Expected: api `36 passed` / `345 passed`; web prints only `web-done`; clean tree.

---

### Task 1: `LedgerService.setTo` — the atomic absolute set

**Files:**
- Modify: `api/src/shared/ledger/ledger.service.ts`
- Test: `api/src/shared/ledger/ledger.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `api/src/shared/ledger/ledger.service.spec.ts`, inside the top-level `describe('LedgerService', ...)`, after the existing tests:

```ts
  describe('setTo', () => {
    it('sets an absolute total in one atomic write and records the difference as manual', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 52400 });
      const r = await service.setTo(51170, 'cash not tracked');
      expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { balance: 51170, lastActivity: expect.any(Date) } },
        { upsert: true, new: false, setDefaultsOnInsert: true },
      );
      expect(historyModel.create).toHaveBeenCalledWith({
        userId: 1,
        previousBalance: 52400,
        newBalance: 51170,
        delta: -1230,
        reason: 'manual',
        transactionName: 'cash not tracked',
      });
      expect(r).toEqual({ previousBalance: 52400, newBalance: 51170, delta: -1230 });
    });

    it('records nothing when the total is unchanged', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 500 });
      const r = await service.setTo(500);
      expect(historyModel.create).not.toHaveBeenCalled();
      expect(r).toEqual({ previousBalance: 500, newBalance: 500, delta: 0 });
    });

    it('starts from zero when no balance exists yet', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce(null);
      const r = await service.setTo(100);
      expect(r).toEqual({ previousBalance: 0, newBalance: 100, delta: 100 });
      expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ previousBalance: 0, delta: 100 }));
    });

    it('rounds the difference to cents', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 0.1 });
      expect((await service.setTo(0.3)).delta).toBe(0.2);
    });

    it('keeps the correction when writing history fails', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 10 });
      historyModel.create.mockRejectedValueOnce(new Error('history down'));
      await expect(service.setTo(20)).resolves.toEqual({ previousBalance: 10, newBalance: 20, delta: 10 });
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ledger.service 2>&1 | tail -8
```

Expected: FAIL — TypeScript `Property 'setTo' does not exist on type 'LedgerService'`.

- [ ] **Step 3: Implement**

In `api/src/shared/ledger/ledger.service.ts`, add this method to the class, after `reverse(...)`:

```ts
  /**
   * Sets the balance to an absolute total: the user's correction against their
   * real accounts. One atomic write; the replaced value comes from the
   * pre-image, so no movement landing at the same moment can be lost. An
   * unchanged total records nothing.
   */
  async setTo(
    target: number,
    note?: string,
  ): Promise<{ previousBalance: number; newBalance: number; delta: number }> {
    const before = await this.balanceModel.findOneAndUpdate(
      { userId: this.userId },
      { $set: { balance: target, lastActivity: new Date() } },
      { upsert: true, new: false, setDefaultsOnInsert: true },
    );
    const previousBalance = before?.balance ?? 0;
    const delta = Math.round((target - previousBalance) * 100) / 100;

    if (delta !== 0) {
      // History failure must never break the correction that already happened.
      try {
        await this.historyModel.create({
          userId: this.userId,
          previousBalance,
          newBalance: target,
          delta,
          reason: 'manual',
          transactionName: note,
        });
      } catch (err) {
        this.logger.error('Failed to record balance history', String(err));
      }
    }
    return { previousBalance, newBalance: target, delta };
  }
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ledger.service 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: the ledger suite passes; api **36 suites / 350 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/ledger/ledger.service.ts api/src/shared/ledger/ledger.service.spec.ts
git commit -F- <<'EOF'
feat(api): LedgerService.setTo sets the balance in one atomic write

The user's correction against their real accounts: $set with the pre-image
as the previous balance, so a concurrent movement can't be lost, recorded
as a manual history row with an optional note. An unchanged total records
nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Index the history for the page

**Files:**
- Modify: `api/src/shared/schemas/balance-history.schema.ts`
- Test: `api/src/shared/schemas/balance-history.schema.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `api/src/shared/schemas/balance-history.schema.spec.ts`:

```ts
import { BalanceHistorySchema } from './balance-history.schema';

describe('BalanceHistorySchema', () => {
  // The Balance page lists a user's history newest first, and its chart reads
  // a time window; without this index both scan the whole collection.
  it('declares an index on (userId, timestamp desc)', () => {
    expect(BalanceHistorySchema.indexes()).toContainEqual([{ userId: 1, timestamp: -1 }, expect.any(Object)]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- balance-history.schema 2>&1 | tail -8
```

Expected: FAIL — the index is not in `indexes()`.

- [ ] **Step 3: Implement**

Append to `api/src/shared/schemas/balance-history.schema.ts`:

```ts

// The Balance page lists a user's history newest first and charts a window of it.
BalanceHistorySchema.index({ userId: 1, timestamp: -1 });
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- balance-history.schema 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 1 passed; api **37 suites / 351 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/balance-history.schema.ts api/src/shared/schemas/balance-history.schema.spec.ts
git commit -F- <<'EOF'
feat(api): index balance history by user and time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `daily-closings.ts` — one closing balance per local day

**Files:**
- Create: `api/src/balance/daily-closings.ts`
- Test: `api/src/balance/daily-closings.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/balance/daily-closings.spec.ts`:

```ts
import { dailyClosings, windowStart } from './daily-closings';

const at = (iso: string) => new Date(iso);
const START = at('2026-09-20T04:00:00Z'); // local midnight, Sep 20

describe('dailyClosings', () => {
  it('carries the previous closing forward over days with no movement', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 5,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-21T15:00:00Z'), newBalance: 900 },
        { timestamp: at('2026-09-23T15:00:00Z'), newBalance: 1200 },
      ],
    });
    expect(points).toEqual([
      { day: '2026-09-20', balance: 1000 },
      { day: '2026-09-21', balance: 900 },
      { day: '2026-09-22', balance: 900 },
      { day: '2026-09-23', balance: 1200 },
      { day: '2026-09-24', balance: 1200 },
    ]);
  });

  it('takes the last row of each day', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 2,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-21T13:00:00Z'), newBalance: 900 },
        { timestamp: at('2026-09-21T20:00:00Z'), newBalance: 850 },
      ],
    });
    expect(points[1]).toEqual({ day: '2026-09-21', balance: 850 });
  });

  it('counts 03:59 UTC on the previous local day and 04:00 UTC on its own', () => {
    const points = dailyClosings({
      windowStart: START,
      days: 4,
      opening: 1000,
      rows: [
        { timestamp: at('2026-09-22T03:59:00Z'), newBalance: 700 },
        { timestamp: at('2026-09-23T04:00:00Z'), newBalance: 600 },
      ],
    });
    expect(points).toEqual([
      { day: '2026-09-20', balance: 1000 },
      { day: '2026-09-21', balance: 700 },
      { day: '2026-09-22', balance: 700 },
      { day: '2026-09-23', balance: 600 },
    ]);
  });

  it('is a flat line at the opening when there are no rows', () => {
    expect(dailyClosings({ windowStart: START, days: 3, opening: 1000, rows: [] }).map((p) => p.balance)).toEqual([
      1000, 1000, 1000,
    ]);
  });
});

describe('windowStart', () => {
  it('is local midnight days − 1 days before today, whatever the UTC date', () => {
    // 02:00Z Sep 25 is still Sep 24 in Santo Domingo.
    expect(windowStart(at('2026-09-25T02:00:00Z'), 90)).toEqual(at('2026-06-27T04:00:00Z'));
    expect(windowStart(at('2026-09-24T04:00:00Z'), 1)).toEqual(at('2026-09-24T04:00:00Z'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- daily-closings 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module './daily-closings'`.

- [ ] **Step 3: Implement**

Create `api/src/balance/daily-closings.ts`:

```ts
/** Santo Domingo is UTC−4 all year (no DST): local midnight is 04:00 UTC. */
const LOCAL_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

export interface ClosingRow {
  timestamp: Date;
  newBalance: number;
}

export interface DailyPoint {
  day: string; // 'YYYY-MM-DD', Santo Domingo
  balance: number;
}

/** 'YYYY-MM-DD' of the Santo Domingo calendar day containing the instant. */
export function localDay(d: Date): string {
  return new Date(d.getTime() - LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

/** Local midnight of the first day of a `days`-day window ending today (Santo Domingo). */
export function windowStart(now: Date, days: number): Date {
  const local = new Date(now.getTime() - LOCAL_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (days - 1)) + LOCAL_OFFSET_MS,
  );
}

/**
 * One closing balance per local day, oldest first: the newBalance of the
 * day's last row, else the previous day's closing, starting from `opening`.
 * `rows` must be ascending and all at or after `windowStart`.
 */
export function dailyClosings(input: {
  windowStart: Date;
  days: number;
  opening: number;
  rows: ClosingRow[];
}): DailyPoint[] {
  const lastOfDay = new Map<string, number>();
  for (const row of input.rows) lastOfDay.set(localDay(row.timestamp), row.newBalance); // later rows overwrite

  const points: DailyPoint[] = [];
  let balance = input.opening;
  for (let i = 0; i < input.days; i++) {
    const day = localDay(new Date(input.windowStart.getTime() + i * DAY_MS));
    if (lastOfDay.has(day)) balance = lastOfDay.get(day);
    points.push({ day, balance });
  }
  return points;
}
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- daily-closings 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: 5 passed; api **38 suites / 356 tests**.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/balance/daily-closings.ts api/src/balance/daily-closings.spec.ts
git commit -F- <<'EOF'
feat(api): daily closing balances, bucketed by Santo Domingo day

Pure: the last history row of each local day, carried forward over quiet
days from an opening balance.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The three endpoints

**Files:**
- Modify: `api/src/balance/balance.service.ts`, `api/src/balance/balance.controller.ts`, `api/src/balance/balance.module.ts`
- Test: `api/src/balance/balance.service.spec.ts` (create); `api/src/transactions/transactions.controller.spec.ts` (modify)

- [ ] **Step 1: Write the failing tests**

Create `api/src/balance/balance.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Balance } from '../shared/schemas/balance.schema';
import { BalanceHistory } from '../shared/schemas/balance-history.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { windowStart } from './daily-closings';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-24T19:00:00Z');

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = {
    select: jest.fn(() => q),
    sort: jest.fn(() => q),
    skip: jest.fn(() => q),
    limit: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return q;
}

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceModel: { findOne: jest.Mock };
  let historyModel: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock };
  let ledger: { setTo: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOne: jest.fn(() => query({ balance: 5000 })) };
    historyModel = {
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    ledger = { setTo: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0, delta: 0 }) };

    const mod = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: getModelToken(BalanceHistory.name), useValue: historyModel },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();
    service = mod.get(BalanceService);
  });

  describe('set', () => {
    it('sets through the ledger, rounded to cents, with a trimmed note', async () => {
      await service.set({ balance: 51170.456, note: '  cash not tracked  ' });
      expect(ledger.setTo).toHaveBeenCalledWith(51170.46, 'cash not tracked');
    });

    it('treats an empty note as none', async () => {
      await service.set({ balance: 10, note: '   ' });
      expect(ledger.setTo).toHaveBeenCalledWith(10, undefined);
    });

    it('rejects anything but a finite number within ±1e12', async () => {
      for (const bad of ['51170', NaN, Infinity, 2e12, undefined]) {
        await expect(service.set({ balance: bad as any })).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(ledger.setTo).not.toHaveBeenCalled();
    });

    it('rejects a note that is not a string or longer than 100 characters', async () => {
      await expect(service.set({ balance: 1, note: 5 as any })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.set({ balance: 1, note: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
      await service.set({ balance: 1, note: 'x'.repeat(100) });
      expect(ledger.setTo).toHaveBeenCalledTimes(1);
    });
  });

  describe('history', () => {
    it('lists newest first, 20 by default, with names or null', async () => {
      const rows = [
        { _id: 'h1', timestamp: at('2026-09-24T15:00:00Z'), reason: 'expense', delta: -300, newBalance: 700, transactionName: 'uber' },
        { _id: 'h2', timestamp: at('2026-09-24T14:00:00Z'), reason: 'manual', delta: 500, newBalance: 1000 },
      ];
      const q = query(rows);
      historyModel.find.mockReturnValue(q);
      historyModel.countDocuments.mockResolvedValue(2);
      const page = await service.history({});
      expect(historyModel.find).toHaveBeenCalledWith({ userId: 1 });
      expect(q.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(20);
      expect(page).toEqual({
        items: [
          { id: 'h1', timestamp: rows[0].timestamp, reason: 'expense', delta: -300, newBalance: 700, name: 'uber' },
          { id: 'h2', timestamp: rows[1].timestamp, reason: 'manual', delta: 500, newBalance: 1000, name: null },
        ],
        total: 2,
      });
    });

    it('clamps limit to 1..100 and offset to ≥ 0, falling back on junk', async () => {
      const q = query([]);
      historyModel.find.mockReturnValue(q);
      await service.history({ limit: '500', offset: '-3' });
      expect(q.limit).toHaveBeenLastCalledWith(100);
      expect(q.skip).toHaveBeenLastCalledWith(0);
      await service.history({ limit: 'abc', offset: '40' });
      expect(q.limit).toHaveBeenLastCalledWith(20);
      expect(q.skip).toHaveBeenLastCalledWith(40);
    });

    it('filters by kind in both the list and the total', async () => {
      await service.history({ reason: 'manual' });
      expect(historyModel.find).toHaveBeenCalledWith({ userId: 1, reason: 'manual' });
      expect(historyModel.countDocuments).toHaveBeenCalledWith({ userId: 1, reason: 'manual' });
    });

    it('rejects an unknown kind', async () => {
      await expect(service.history({ reason: 'refund' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('daily', () => {
    it('opens from the latest row before the window', async () => {
      const before = query({ newBalance: 800 });
      historyModel.findOne.mockReturnValue(before);
      const points = await service.daily({ days: '7' }, NOW);
      expect(historyModel.findOne).toHaveBeenCalledWith({ userId: 1, timestamp: { $lt: windowStart(NOW, 7) } });
      expect(before.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
      expect(points).toHaveLength(7);
      expect(points.every((p) => p.balance === 800)).toBe(true);
    });

    it("otherwise opens from the first window row's previous balance", async () => {
      historyModel.find.mockReturnValue(
        query([{ timestamp: at('2026-09-23T15:00:00Z'), newBalance: 900, previousBalance: 1000 }]),
      );
      const points = await service.daily({ days: '7' }, NOW);
      expect(points[0].balance).toBe(1000);
      expect(points[6].balance).toBe(900);
    });

    it('otherwise is flat at the live balance, or 0 without one', async () => {
      expect((await service.daily({ days: '7' }, NOW)).every((p) => p.balance === 5000)).toBe(true);
      balanceModel.findOne.mockReturnValue(query(null));
      expect((await service.daily({ days: '7' }, NOW)).every((p) => p.balance === 0)).toBe(true);
    });

    it('clamps days to 7..365, 90 by default', async () => {
      expect(await service.daily({ days: '3' }, NOW)).toHaveLength(7);
      expect(await service.daily({ days: '1000' }, NOW)).toHaveLength(365);
      expect(await service.daily({}, NOW)).toHaveLength(90);
    });
  });
});
```

In `api/src/transactions/transactions.controller.spec.ts`, add `import { BalanceController } from '../balance/balance.controller';` and add `['BalanceController', BalanceController],` to the `describe.each([...])` list.

- [ ] **Step 2: Run to verify it fails**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- balance.service transactions.controller 2>&1 | tail -10
```

Expected: `balance.service.spec.ts` fails to compile (`set`, `history`, `daily` don't exist). The new `BalanceController` guard case passes already (the guard is on the class today) — it is a pin; note it.

- [ ] **Step 3: Implement the service**

Replace the whole of `api/src/balance/balance.service.ts` with:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../shared/schemas/balance.schema';
import { BalanceHistory } from '../shared/schemas/balance-history.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { dailyClosings, DailyPoint, windowStart } from './daily-closings';

export const HISTORY_REASONS = ['income', 'expense', 'delete', 'manual', 'recurring'] as const;
const MAX_ABS_BALANCE = 1e12;
const NOTE_MAX = 100;

export interface SetBalanceBody {
  balance: number;
  note?: string;
}

/** An integer query value, clamped; `fallback` when absent or not an integer. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

@Injectable()
export class BalanceService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private historyModel: Model<BalanceHistory>,
    private readonly ledger: LedgerService,
  ) {}

  async get() {
    return this.balanceModel
      .findOne({ userId: this.userId })
      .select('balance isPremium lastActivity language')
      .lean();
  }

  /** Sets the balance to the total the user's accounts show; recorded as a manual adjustment. */
  async set(body: SetBalanceBody) {
    const { balance, note } = body ?? ({} as SetBalanceBody);
    if (typeof balance !== 'number' || !Number.isFinite(balance) || Math.abs(balance) > MAX_ABS_BALANCE) {
      throw new BadRequestException(`balance must be a finite number within ±${MAX_ABS_BALANCE} (got ${balance})`);
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
      throw new BadRequestException('note must be a string');
    }
    const trimmed = typeof note === 'string' ? note.trim() : '';
    if (trimmed.length > NOTE_MAX) throw new BadRequestException(`note must be at most ${NOTE_MAX} characters`);

    return this.ledger.setTo(Math.round(balance * 100) / 100, trimmed || undefined);
  }

  async history(query: { limit?: string; offset?: string; reason?: string }) {
    const limit = clampInt(query.limit, 20, 1, 100);
    const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const filter: Record<string, unknown> = { userId: this.userId };
    if (query.reason !== undefined && query.reason !== '') {
      if (!(HISTORY_REASONS as readonly string[]).includes(query.reason)) {
        throw new BadRequestException(`reason must be one of ${HISTORY_REASONS.join(', ')}`);
      }
      filter.reason = query.reason;
    }

    const [rows, total] = await Promise.all([
      this.historyModel.find(filter).sort({ timestamp: -1, _id: -1 }).skip(offset).limit(limit).lean(),
      this.historyModel.countDocuments(filter),
    ]);
    return {
      items: rows.map((r) => ({
        id: String(r._id),
        timestamp: r.timestamp,
        reason: r.reason,
        delta: r.delta,
        newBalance: r.newBalance,
        name: r.transactionName ?? null,
      })),
      total,
    };
  }

  /**
   * Daily closing balances for the chart, drawn from history only. The live
   * balance is used only when there is no history at all (a flat line).
   */
  async daily(query: { days?: string }, now: Date = new Date()): Promise<DailyPoint[]> {
    const days = clampInt(query.days, 90, 7, 365);
    const start = windowStart(now, days);

    const [before, rows] = await Promise.all([
      this.historyModel
        .findOne({ userId: this.userId, timestamp: { $lt: start } })
        .sort({ timestamp: -1, _id: -1 })
        .select('newBalance')
        .lean(),
      this.historyModel
        .find({ userId: this.userId, timestamp: { $gte: start } })
        .sort({ timestamp: 1, _id: 1 })
        .select('timestamp newBalance previousBalance')
        .lean(),
    ]);

    let opening: number;
    if (before) opening = before.newBalance;
    else if (rows.length > 0) opening = rows[0].previousBalance;
    else opening = (await this.balanceModel.findOne({ userId: this.userId }).select('balance').lean())?.balance ?? 0;

    return dailyClosings({ windowStart: start, days, opening, rows });
  }
}
```

- [ ] **Step 4: Implement the controller and module**

Replace the whole of `api/src/balance/balance.controller.ts` with:

```ts
import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { BalanceService, SetBalanceBody } from './balance.service';

@Controller('balance')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  get() {
    return this.balanceService.get();
  }

  @Put()
  set(@Body() body: SetBalanceBody) {
    return this.balanceService.set(body);
  }

  @Get('history')
  history(@Query('limit') limit?: string, @Query('offset') offset?: string, @Query('reason') reason?: string) {
    return this.balanceService.history({ limit, offset, reason });
  }

  @Get('daily')
  daily(@Query('days') days?: string) {
    return this.balanceService.daily({ days });
  }
}
```

Replace the whole of `api/src/balance/balance.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { BalanceHistory, BalanceHistorySchema } from '../shared/schemas/balance-history.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Balance.name, schema: BalanceSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
    ]),
    LedgerModule,
  ],
  controllers: [BalanceController],
  providers: [BalanceService],
})
export class BalanceModule {}
```

- [ ] **Step 5: Run to verify it passes, then the full suite and build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- balance.service transactions.controller 2>&1 | tail -5 && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```

Expected: api **39 suites / 369 tests** (+12 in `balance.service.spec.ts`, +1 guard case); build exits 0.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/balance/balance.service.ts api/src/balance/balance.service.spec.ts api/src/balance/balance.controller.ts api/src/balance/balance.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): PUT /balance, GET /balance/history and GET /balance/daily

Set the balance to a real total (validated, rounded to cents, optional
note) through the ledger; page the history newest first with an optional
kind filter; and chart 7-365 days of closing balances from history, the
opening taken from the last earlier row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Web — models and API calls

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`

- [ ] **Step 1: Add the models**

Append to `web/src/app/core/services/api.models.ts`:

```ts

export type BalanceChangeReason = 'income' | 'expense' | 'delete' | 'manual' | 'recurring';

export interface BalanceHistoryItem {
  id: string;
  timestamp: string;
  reason: BalanceChangeReason;
  delta: number;
  newBalance: number;
  name: string | null;
}

export interface BalanceHistoryPage {
  items: BalanceHistoryItem[];
  total: number;
}

export interface DailyBalance {
  day: string; // 'YYYY-MM-DD', Santo Domingo
  balance: number;
}

export interface SetBalanceResult {
  previousBalance: number;
  newBalance: number;
  delta: number;
}
```

- [ ] **Step 2: Add the calls**

In `web/src/app/core/services/api.service.ts`, add `BalanceChangeReason, BalanceHistoryPage, DailyBalance, SetBalanceResult` to the existing `import { ... } from './api.models';` list, and add these methods directly after `getBalance()`:

```ts
  /** Sets the balance to the total the user's accounts show; recorded as a manual adjustment. */
  setBalance(balance: number, note?: string): Observable<SetBalanceResult> {
    return this.http.put<SetBalanceResult>(`${this.base}/balance`, note ? { balance, note } : { balance });
  }

  getBalanceHistory(opts: { limit?: number; offset?: number; reason?: BalanceChangeReason } = {}): Observable<BalanceHistoryPage> {
    let params = new HttpParams();
    if (opts.limit !== undefined) params = params.set('limit', opts.limit);
    if (opts.offset !== undefined) params = params.set('offset', opts.offset);
    if (opts.reason) params = params.set('reason', opts.reason);
    return this.http.get<BalanceHistoryPage>(`${this.base}/balance/history`, { params });
  }

  getDailyBalance(days = 90): Observable<DailyBalance[]> {
    return this.http.get<DailyBalance[]>(`${this.base}/balance/daily`, { params: new HttpParams().set('days', days) });
  }
```

- [ ] **Step 3: Build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```

Expected: only `web-done`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/core/services/api.models.ts web/src/app/core/services/api.service.ts
git commit -F- <<'EOF'
feat(web): API calls for setting the balance and reading its history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Web — the Balance page, its route and nav item

**Files:**
- Create: `web/src/app/pages/balance/balance.component.ts`
- Create: `web/src/app/pages/balance/balance.component.html`
- Create: `web/src/app/pages/balance/balance.component.scss`
- Modify: `web/src/app/app.routes.ts`, `web/src/app/app.component.ts`

- [ ] **Step 1: The component**

Create `web/src/app/pages/balance/balance.component.ts`:

```ts
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { TransactionEventsService } from '../../core/services/transaction-events.service';
import {
  BalanceChangeReason,
  BalanceHistoryItem,
  BalanceSummary,
  DailyBalance,
} from '../../core/services/api.models';

Chart.register(...registerables);

type Filter = 'all' | BalanceChangeReason;

const PAGE_SIZE = 20;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MINUS = '\u2212';

@Component({
  selector: 'app-balance',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, MatIconModule],
  templateUrl: './balance.component.html',
  styleUrls: ['./balance.component.scss'],
})
export class BalanceComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;

  readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'delete', label: 'Deleted' },
    { value: 'manual', label: 'Set by you' },
    { value: 'recurring', label: 'Recurring' },
  ];
  readonly kindLabel: Record<string, string> = {
    income: 'Income',
    expense: 'Expense',
    delete: 'Deleted',
    manual: 'Set by you',
    recurring: 'Recurring',
  };

  balance: BalanceSummary | null = null;
  loading = true;
  headerError = '';

  daily: DailyBalance[] = [];
  chartError = '';

  filter: Filter = 'all';
  items: BalanceHistoryItem[] = [];
  total = 0;
  listLoading = false;
  loadingMore = false;
  listError = '';

  formOpen = false;
  amount: number | null = null;
  note = '';
  saving = false;
  formError = '';

  private chart: Chart | null = null;
  private readonly subs = new Subscription();
  private destroyed = false;

  constructor(private api: ApiService, private events: TransactionEventsService) {}

  ngOnInit(): void {
    // Any write anywhere (this page's form, the + button, a row action) reloads the page.
    this.subs.add(this.events.changed$.subscribe(() => this.reloadAll()));
    this.reloadAll();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subs.unsubscribe();
    this.chart?.destroy();
    this.chart = null;
  }

  get current(): number {
    return this.balance?.balance ?? 0;
  }

  get hasMore(): boolean {
    return this.items.length < this.total;
  }

  /** The adjustment the form would record, or null when the amount is not a usable number. */
  get delta(): number | null {
    if (this.amount === null || !Number.isFinite(this.amount)) return null;
    return Math.round((this.amount - this.current) * 100) / 100;
  }

  get canConfirm(): boolean {
    return !this.saving && this.delta !== null && this.delta !== 0;
  }

  get preview(): string {
    const d = this.delta;
    if (d === null || this.amount === null) return '';
    if (d === 0) return 'No change.';
    return `This records an adjustment of ${this.signed(d)} (from ${this.money(this.current)} to ${this.money(this.amount)}).`;
  }

  money(n: number): string {
    return `${n < 0 ? MINUS : ''}${USD.format(Math.abs(n))}`;
  }

  signed(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${USD.format(Math.abs(n))}`;
  }

  rowName(h: BalanceHistoryItem): string {
    if (h.reason === 'manual') return h.name || 'Balance set';
    return h.name || this.kindLabel[h.reason] || h.reason;
  }

  openForm(): void {
    this.formOpen = true;
    this.amount = this.current;
    this.note = '';
    this.formError = '';
  }

  cancelForm(): void {
    if (this.saving) return;
    this.formOpen = false;
    this.formError = '';
  }

  confirm(): void {
    if (!this.canConfirm || this.amount === null) return;
    this.saving = true;
    this.formError = '';
    const note = this.note.trim();
    this.subs.add(
      this.api.setBalance(this.amount, note || undefined).subscribe({
        next: () => {
          this.saving = false;
          this.formOpen = false;
          this.events.notify(); // reloads this page (see ngOnInit) and the Dashboard
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.formError = typeof e.error?.message === 'string' ? e.error.message : "Couldn't set the balance.";
        },
      }),
    );
  }

  setFilter(f: Filter): void {
    if (f === this.filter) return;
    this.filter = f;
    this.items = [];
    this.total = 0;
    this.loadList();
  }

  loadMore(): void {
    if (this.loadingMore || !this.hasMore) return;
    const filter = this.filter;
    this.loadingMore = true;
    this.subs.add(
      this.api
        .getBalanceHistory({ limit: PAGE_SIZE, offset: this.items.length, reason: filter === 'all' ? undefined : filter })
        .subscribe({
          next: (page) => {
            this.loadingMore = false;
            if (filter !== this.filter) return;
            this.items = [...this.items, ...page.items];
            this.total = page.total;
            this.listError = '';
          },
          error: () => {
            this.loadingMore = false;
            if (filter !== this.filter) return;
            this.listError = "Couldn't load more history.";
          },
        }),
    );
  }

  private reloadAll(): void {
    this.loadHeader();
    this.loadChart();
    this.loadList();
  }

  private loadHeader(): void {
    this.subs.add(
      this.api.getBalance().subscribe({
        next: (b) => {
          this.balance = b;
          this.headerError = '';
          this.loading = false;
        },
        error: () => {
          this.headerError = "Couldn't load the balance.";
          this.loading = false;
        },
      }),
    );
  }

  private loadChart(): void {
    this.subs.add(
      this.api.getDailyBalance(90).subscribe({
        next: (points) => {
          this.daily = points;
          this.chartError = '';
          // Defer one tick so the canvas is in the DOM before we draw on it.
          setTimeout(() => {
            if (!this.destroyed) this.buildChart();
          }, 0);
        },
        error: () => {
          this.chartError = "Couldn't load the chart.";
        },
      }),
    );
  }

  private loadList(): void {
    const filter = this.filter;
    this.listLoading = true;
    this.subs.add(
      this.api
        .getBalanceHistory({ limit: PAGE_SIZE, offset: 0, reason: filter === 'all' ? undefined : filter })
        .subscribe({
          next: (page) => {
            if (filter !== this.filter) return; // a newer filter's request owns the list
            this.listLoading = false;
            this.items = page.items;
            this.total = page.total;
            this.listError = '';
          },
          error: () => {
            if (filter !== this.filter) return;
            this.listLoading = false;
            this.listError = "Couldn't load the history.";
          },
        }),
    );
  }

  private buildChart(): void {
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas) return;
    const isFirstBuild = !this.chart;
    this.chart?.destroy();

    // Theme colours, read at runtime so the chart follows the design tokens.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const label = (day: string) =>
      new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: this.daily.map((p) => label(p.day)),
        datasets: [
          {
            data: this.daily.map((p) => p.balance),
            borderColor: token('--accent'),
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: isFirstBuild ? undefined : false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => this.money(c.parsed.y) } },
        },
        scales: {
          x: { grid: { color: token('--border') }, ticks: { color: token('--text-muted'), maxTicksLimit: 6 } },
          y: { grid: { color: token('--border') }, ticks: { color: token('--text-muted') } },
        },
      },
    });
  }
}
```

- [ ] **Step 2: The template**

Create `web/src/app/pages/balance/balance.component.html`:

```html
<div class="page-wrap">
  <div class="bal-header">
    <div>
      <h1>Balance</h1>
      @if (loading) {
        <p class="bal-muted">Loading…</p>
      } @else if (headerError) {
        <p class="fc-error" role="alert">{{ headerError }}</p>
      } @else {
        <p class="bal-amount">{{ current | currency:'USD':'symbol':'1.2-2' }}</p>
        @if (balance?.lastActivity) {
          <p class="bal-muted">Last activity {{ balance!.lastActivity | date:'MMM d, h:mm a':'-0400' }}</p>
        }
      }
    </div>
    @if (!formOpen) {
      <button type="button" class="fc-btn fc-btn--primary" [disabled]="loading" (click)="openForm()">
        <mat-icon>edit</mat-icon> Set balance
      </button>
    }
  </div>

  @if (formOpen) {
    <section class="card bal-section" aria-labelledby="bal-form-title">
      <h2 id="bal-form-title">Set balance</h2>
      <p class="bal-muted">
        Type the total your accounts show now. The difference is recorded as an adjustment you made; it never counts as
        income or expense.
      </p>
      <div class="bal-form-row">
        <label class="fc-field">
          <span>New balance</span>
          <input class="fc-input" type="number" step="0.01" [(ngModel)]="amount" name="amount" />
        </label>
        <label class="fc-field bal-note">
          <span>Note</span>
          <input class="fc-input" type="text" maxlength="100" placeholder="Why? (optional)" [(ngModel)]="note" name="note" />
        </label>
      </div>
      @if (preview) {
        <p class="bal-preview" aria-live="polite">{{ preview }}</p>
      }
      @if (formError) {
        <p class="fc-error" role="alert">{{ formError }}</p>
      }
      <div class="bal-actions">
        <button type="button" class="fc-btn fc-btn--ghost" [disabled]="saving" (click)="cancelForm()">Cancel</button>
        <button type="button" class="fc-btn fc-btn--primary" [disabled]="!canConfirm" (click)="confirm()">
          <mat-icon>{{ saving ? 'hourglass_empty' : 'check' }}</mat-icon> {{ saving ? 'Saving…' : 'Confirm' }}
        </button>
      </div>
    </section>
  }

  <section class="card bal-section" aria-labelledby="bal-chart-title">
    <h2 id="bal-chart-title">Last 90 days</h2>
    @if (chartError) {
      <p class="fc-error" role="alert">{{ chartError }}</p>
    }
    <div class="bal-chart-box">
      <canvas #chartCanvas role="img" aria-label="Daily closing balance over the last 90 days"></canvas>
    </div>
  </section>

  <section class="card bal-section" aria-labelledby="bal-history-title">
    <h2 id="bal-history-title">History</h2>
    <div class="bal-chips" role="group" aria-label="Filter by kind">
      @for (f of filters; track f.value) {
        <button
          type="button"
          class="bal-chip"
          [class.active]="filter === f.value"
          [attr.aria-pressed]="filter === f.value"
          (click)="setFilter(f.value)"
        >
          {{ f.label }}
        </button>
      }
    </div>

    @if (listError) {
      <p class="fc-error" role="alert">{{ listError }}</p>
    }

    @if (listLoading && items.length === 0) {
      <p class="bal-muted">Loading…</p>
    } @else if (items.length === 0 && !listError) {
      <p class="bal-muted">No history for this kind yet.</p>
    } @else {
      <ul class="bal-list">
        @for (h of items; track h.id) {
          <li class="bal-row">
            <div class="bal-row-main">
              <span class="bal-row-name">{{ rowName(h) }}</span>
              <span class="bal-row-meta">
                {{ h.timestamp | date:'MMM d, h:mm a':'-0400' }} · {{ kindLabel[h.reason] || h.reason }}
              </span>
            </div>
            <div class="bal-row-nums">
              <span class="bal-delta" [class.up]="h.delta > 0" [class.down]="h.delta < 0">{{ signed(h.delta) }}</span>
              <span class="bal-after">{{ money(h.newBalance) }}</span>
            </div>
          </li>
        }
      </ul>
      @if (hasMore) {
        <button type="button" class="fc-btn fc-btn--ghost bal-more" [disabled]="loadingMore" (click)="loadMore()">
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
      }
    }
  </section>
</div>
```

- [ ] **Step 3: The styles (tokens only)**

Create `web/src/app/pages/balance/balance.component.scss`:

```scss
.bal-header {
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

.bal-amount {
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text);
}

.bal-muted {
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.bal-section {
  margin-bottom: var(--space-lg);

  h2 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-lg);
  }
}

.bal-form-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-sm);

  .bal-note {
    flex: 1 1 240px;
  }
}

.bal-preview {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-sm);
  color: var(--text);
}

.bal-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-top: var(--space-md);
}

.bal-chart-box {
  position: relative;
  height: 220px;
}

.bal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.bal-chip {
  border: 1px solid var(--border);
  background: none;
  color: var(--text-muted);
  border-radius: var(--radius-pill);
  padding: var(--space-3xs) var(--space-sm);
  font-size: var(--text-sm);
  cursor: pointer;

  &:hover:not(.active) {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--color-accent-ink);
  }
}

.bal-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bal-row {
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

.bal-row-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bal-row-name {
  color: var(--text);
  overflow-wrap: anywhere;
}

.bal-row-meta,
.bal-after {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.bal-row-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bal-delta {
  font-weight: 600;

  &.up {
    color: var(--income);
  }

  &.down {
    color: var(--expense);
  }
}

.bal-more {
  margin-top: var(--space-sm);
}
```

- [ ] **Step 4: Route and nav item**

In `web/src/app/app.routes.ts`, add directly after the `dashboard` route object:

```ts
  {
    path: 'balance',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/balance/balance.component').then((m) => m.BalanceComponent),
  },
```

In `web/src/app/app.component.ts`, add directly after the `Dashboard` nav entry, keeping the file's column alignment:

```ts
    { label: 'Balance',      icon: 'account_balance',        path: '/balance' },
```

- [ ] **Step 5: Build and check styles**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff -- web | grep -nE "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()"; echo literal-done
```

Expected: only `web-done` and `literal-done` (a new lazy chunk named `balance-component` in the build table is expected and not a warning). If the build warns about a component style budget, report it — do not raise the budget.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/balance/balance.component.ts web/src/app/pages/balance/balance.component.html web/src/app/pages/balance/balance.component.scss web/src/app/app.routes.ts web/src/app/app.component.ts
git commit -F- <<'EOF'
feat(web): Balance page — set the balance, chart it, and read its history

The current balance with an inline "Set balance" form that previews the
adjustment before confirming; a 90-day stepped chart in theme colours; and
the history, newest first with Load more and single-choice filter chips.
Second in the nav.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Web — the Dashboard's balance card links to the page

**Files:**
- Modify: `web/src/app/pages/dashboard/dashboard.component.ts`
- Modify: `web/src/app/pages/dashboard/dashboard.component.html`
- Modify: `web/src/app/pages/dashboard/dashboard.component.scss`

- [ ] **Step 1: `StatCard.link`**

In `web/src/app/pages/dashboard/dashboard.component.ts`, add `link?: string;` as the last field of `interface StatCard`, and add `link: '/balance',` to the `'Total Balance'` object in `buildStats` (after its `sub:` line).

- [ ] **Step 2: Render the card as a link when it has one**

In `web/src/app/pages/dashboard/dashboard.component.html`, replace the stat-card loop:

```html
      @for (s of stats; track s.label) {
        <div class="stat-card" [class]="s.cls">
          <div class="stat-label">{{ s.label }}</div>
          <div class="stat-amount">{{ s.amount | currency:'USD':'symbol':'1.0-0' }}</div>
          @if (s.badgePct !== null) {
            <span class="stat-badge" [class]="s.badgeDir">
              {{ badgeLabel(s.badgePct, s.badgeDir) }} vs last month
            </span>
          }
          @if (s.sub) {
            <div class="stat-sub">{{ s.sub }}</div>
          }
          <mat-icon class="ghost-icon">{{ s.icon }}</mat-icon>
        </div>
      }
```

with:

```html
      @for (s of stats; track s.label) {
        @if (s.link) {
          <a class="stat-card stat-card--link" [class]="s.cls" [routerLink]="s.link">
            <ng-container *ngTemplateOutlet="statBody; context: { $implicit: s }" />
          </a>
        } @else {
          <div class="stat-card" [class]="s.cls">
            <ng-container *ngTemplateOutlet="statBody; context: { $implicit: s }" />
          </div>
        }
      }
```

and, directly after the closing `</div>` of that `stat-grid` block, add the shared body:

```html
    <ng-template #statBody let-s>
      <div class="stat-label">{{ s.label }}</div>
      <div class="stat-amount">{{ s.amount | currency:'USD':'symbol':'1.0-0' }}</div>
      @if (s.badgePct !== null) {
        <span class="stat-badge" [class]="s.badgeDir">
          {{ badgeLabel(s.badgePct, s.badgeDir) }} vs last month
        </span>
      }
      @if (s.sub) {
        <div class="stat-sub">{{ s.sub }}</div>
      }
      <mat-icon class="ghost-icon">{{ s.icon }}</mat-icon>
    </ng-template>
```

(`NgTemplateOutlet` comes with `CommonModule` and `RouterLink` is already imported by the component.)

- [ ] **Step 3: Link states (tokens only, no `display` override)**

Append to `web/src/app/pages/dashboard/dashboard.component.scss`:

```scss
.stat-card--link {
  color: inherit;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    border-color: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```

Expected: only `web-done`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/dashboard/dashboard.component.ts web/src/app/pages/dashboard/dashboard.component.html web/src/app/pages/dashboard/dashboard.component.scss
git commit -F- <<'EOF'
feat(web): the Dashboard's balance card opens the Balance page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the page and endpoints**

In `README.md`:

1. In the Web Dashboard features table, directly after the row starting `| **Dashboard** |`, add:

```markdown
| **Balance** | Set the balance to the total your accounts show (recorded as an adjustment, never as income or expense); a 90-day chart and the full history, filterable by kind |
```

2. In the API reference table, directly after the row `` | `GET` | `/api/balance` | Current balance summary | ``, add:

```markdown
| `PUT` | `/api/balance` | Set the balance to a total `{ balance, note? }`; recorded as a manual adjustment |
| `GET` | `/api/balance/history` | Balance history, newest first (`limit`, `offset`, `reason`) |
| `GET` | `/api/balance/daily` | Daily closing balances for the last `days` days (default 90) |
```

- [ ] **Step 2: Verify and commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && grep -nE "\*\*Balance\*\*|/api/balance/(history|daily)|PUT\` \| \`/api/balance" README.md
git add README.md
git commit -F- <<'EOF'
docs(readme): the Balance page and its endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: four matching lines before the commit.

---

### Task 9: Final verification (no commit unless something is wrong)

- [ ] **Step 1: Suites and builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/repo" && npm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff --stat HEAD~8 -- repo
```

Expected: api **39 suites / 369 tests**, build clean; repo **13 / 82** (untouched); web clean; the `repo` diff empty.

- [ ] **Step 2: Hygiene**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git log --format=%B -8 | grep -c "Co-Authored-By: Claude Opus 5.5"
git grep -nE "LedgerService|findOneAndUpdate" -- api/src/balance
git status --short
```

Expected: `8`; in `api/src/balance` only `balance.service.ts` references `LedgerService` and nothing calls `findOneAndUpdate` (the balance moves only through the ledger); clean tree. The controller runs the private-identifier check separately.

---

## After the tasks (controller)

1. Spec review, then code-quality review; fixes; private-identifier gate; push.
2. Hand the user: `rollout restart` of `accounting-api` and `accounting-web` once CI is green; open **Balance** in the nav; set the balance to the total your accounts show, then see the "Set by you" row and the chart's step.
