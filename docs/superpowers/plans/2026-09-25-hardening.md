# Hardening (Group 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six follow-ups from earlier plans:
- mail times that depend on `TZ`;
- cash usage and the cash counter;
- duplicate category names;
- recurring day-of-month bounds;
- noisy mail-check counts;
- own-name fragments that match inside other names.

**Architecture:** Six independent tasks, each touching its own area of `api/src` (and, for Tasks 5–6, one Settings section in `web/`). Task 1 adds one shared module, `api/src/shared/santo-domingo.ts`, that does fixed-offset UTC−4 math; every other task stands alone.

**Tech Stack:** NestJS 10, Mongoose 8, Jest (`cd api && npx jest …`, pinned to America/Santo_Domingo by `api/jest.timezone.js`), Angular 17 standalone (`cd web && npx ng build`; no test runner).

**Spec:** `docs/superpowers/specs/2026-09-25-hardening-design.md`

**Baseline:** `cd api && npx jest` gives 64 suites and 733 tests, all passing.

**Repo rules (every task):**
- The repo is PUBLIC: no real names, account numbers, emails or ids. Use only the synthetic names already in the tests (JUAN ANTONIO RIVERA MARTE, PEDRO NUNEZ, MARIA ALTAGRACIA GOMEZ REYES) or generic ones.
- End every commit message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't push.

---

## File structure

| File | Task | Change |
|---|---|---|
| `api/src/shared/santo-domingo.ts` (+ spec) | 1 | New: fixed-offset Santo Domingo helpers |
| `api/src/ingestion/parsers/dates.ts` (+ spec) | 1 | Parsers build instants with `santoDomingoInstant` |
| `api/src/balance/daily-closings.ts`, `api/src/reports/report-render.ts`, `api/src/recurring/due-occurrences.ts`, `api/src/reports/report-periods.ts` | 1 | Use the module instead of their own offset copies |
| `api/src/categories/category-references.service.ts` (+ spec) | 2 | `usage()` counts only items of live withdrawals |
| `api/src/cash/cash.service.ts` (+ spec) | 2 | Counter repair on a refused add |
| `api/src/shared/schemas/custom-category.schema.ts` (+ spec), `api/src/categories/categories.service.ts` (+ spec) | 3 | Partial unique index; duplicate-key → 409 |
| `api/src/shared/schemas/recurring.schema.ts` (+ spec), `api/src/recurring/due-occurrences.ts` (+ spec), `api/src/recurring/recurring-scheduler.service.ts` (+ spec) | 4 | Day bounds; the sweep skips a bad rule |
| `api/src/ingestion/ingestion-status.service.ts`, `ingestion.service.ts`, `ingestion.controller.ts` (+ specs), `api/src/shared/schemas/ingestion-status.schema.ts`, `web/.../api.models.ts`, `web/.../settings/mail-section/*` | 5 | Five run counts |
| `api/src/ingestion/parsers/own-party.ts` (+ spec), `web/.../settings/accounts-section/accounts-section.component.html` | 6 | Whole-word name fragments |

---

### Task 1: Santo Domingo time without `TZ`

**Files:**
- Create: `api/src/shared/santo-domingo.ts`, `api/src/shared/santo-domingo.spec.ts`
- Modify: `api/src/ingestion/parsers/dates.ts`, `api/src/ingestion/parsers/dates.spec.ts`
- Modify: `api/src/balance/daily-closings.ts`, `api/src/reports/report-render.ts`, `api/src/recurring/due-occurrences.ts`, `api/src/reports/report-periods.ts`

- [ ] **Step 1: Write the failing tests.** Create `api/src/shared/santo-domingo.spec.ts`:

```ts
import { SANTO_DOMINGO_OFFSET_HOURS, santoDomingoDateKey, santoDomingoInstant, santoDomingoWallClock } from './santo-domingo';

describe('santo-domingo', () => {
  it('is UTC−4 all year', () => {
    expect(SANTO_DOMINGO_OFFSET_HOURS).toBe(4);
  });

  it('turns a Santo Domingo wall-clock time into its instant', () => {
    expect(santoDomingoInstant(2026, 8, 18, 15, 11).toISOString()).toBe('2026-09-18T19:11:00.000Z');
    expect(santoDomingoInstant(2026, 8, 21, 12, 32, 21).toISOString()).toBe('2026-09-21T16:32:21.000Z');
  });

  it('puts local midnight at 04:00 UTC, and rolls past a year end', () => {
    expect(santoDomingoInstant(2026, 8, 18).toISOString()).toBe('2026-09-18T04:00:00.000Z');
    expect(santoDomingoInstant(2026, 11, 31, 23, 30).toISOString()).toBe('2027-01-01T03:30:00.000Z');
  });

  it('reads the local calendar day of an instant', () => {
    expect(santoDomingoDateKey(new Date('2026-09-18T03:59:59.999Z'))).toBe('2026-09-17');
    expect(santoDomingoDateKey(new Date('2026-09-18T04:00:00.000Z'))).toBe('2026-09-18');
  });

  it('gives the local clock through the UTC getters', () => {
    const l = santoDomingoWallClock(new Date('2026-09-18T19:11:00Z'));
    expect([l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), l.getUTCHours(), l.getUTCMinutes()]).toEqual([2026, 8, 18, 15, 11]);
  });
});
```

Append to `api/src/ingestion/parsers/dates.spec.ts`, and widen its import to every parser:

```ts
import { parseDMyHms, parseDdMmYyyy, parseDdMmYyyy12h, parseDdMmYyyyDash12h, parseSpanishLongDate } from './dates';
```

```ts
// Bank mail states Santo Domingo wall-clock times. They must become the same
// instants however the server's zone is set: a lost TZ line in the Dockerfile
// must not shift every mail by hours.
describe('mail times in any server time zone', () => {
  const saved = process.env.TZ;
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it.each(['UTC', 'Asia/Tokyo', 'America/Santo_Domingo'])('reads Santo Domingo wall-clock times with TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(parseDdMmYyyy('11/09/2026')!.toISOString()).toBe('2026-09-11T04:00:00.000Z');
    expect(parseDdMmYyyy12h('18/09/2026 03:11 pm')!.toISOString()).toBe('2026-09-18T19:11:00.000Z');
    expect(parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM')!.toISOString()).toBe('2026-08-28T12:33:00.000Z');
    expect(parseDMyHms('21/9/2026 12:32:21')!.toISOString()).toBe('2026-09-21T16:32:21.000Z');
    expect(parseSpanishLongDate('18 de Septiembre 2026 - 11:52 AM')!.toISOString()).toBe('2026-09-18T15:52:00.000Z');
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/shared/santo-domingo.spec.ts src/ingestion/parsers/dates.spec.ts`
Expected: `santo-domingo` fails with "Cannot find module", and the dates test fails for `TZ=UTC` and `Asia/Tokyo`.

- [ ] **Step 3: Create `api/src/shared/santo-domingo.ts`.**

```ts
/**
 * Santo Domingo wall-clock time without relying on the process time zone.
 * The Dominican Republic is UTC−4 all year (no daylight saving time), so a
 * fixed offset is exact. Use these wherever a time must be the user's local
 * time however the server is configured: bank-mail times, report and
 * recurring schedules, daily balance closings.
 */
export const SANTO_DOMINGO_OFFSET_HOURS = 4;
const OFFSET_MS = SANTO_DOMINGO_OFFSET_HOURS * 3_600_000;

/** The instant a Santo Domingo wall-clock time happens. `monthIndex` is 0-based, like Date's. */
export function santoDomingoInstant(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour + SANTO_DOMINGO_OFFSET_HOURS, minute, second));
}

/** `d` shifted so its UTC getters read the Santo Domingo calendar and clock. Never store or compare it as an instant. */
export function santoDomingoWallClock(d: Date): Date {
  return new Date(d.getTime() - OFFSET_MS);
}

/** 'YYYY-MM-DD' of the Santo Domingo calendar day containing `d`. */
export function santoDomingoDateKey(d: Date): string {
  return santoDomingoWallClock(d).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Switch the parsers.** In `api/src/ingestion/parsers/dates.ts`, add at the top:

```ts
import { santoDomingoInstant } from '../../shared/santo-domingo';

// Every date here is a Santo Domingo wall-clock time as the bank wrote it, built
// with santoDomingoInstant so the instant never depends on the server's TZ.
```

Then replace the five `new Date(...)` returns exactly as follows:
- `parseDdMmYyyy`: `return santoDomingoInstant(+m[3], +m[2] - 1, +m[1]);`
- `parseDdMmYyyy12h`: `return santoDomingoInstant(+m[3], +m[2] - 1, +m[1], hour, +m[5]);`
- `parseDdMmYyyyDash12h`: `return santoDomingoInstant(+m[3], +m[2] - 1, +m[1], hour, +m[5]);`
- `parseDMyHms`: `return santoDomingoInstant(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);`
- `parseSpanishLongDate`: `return santoDomingoInstant(+m[3], month, +m[1], hour, m[5] ? +m[5] : 0);`

- [ ] **Step 5: Replace the hand-rolled offset copies.** The instants they produce don't change.

`api/src/balance/daily-closings.ts`:
- delete the comment line and `const LOCAL_OFFSET_MS = 4 * 3_600_000;`, keeping `DAY_MS`;
- add `import { santoDomingoDateKey, santoDomingoInstant, santoDomingoWallClock } from '../shared/santo-domingo';`;
- replace the two functions with:

```ts
/** 'YYYY-MM-DD' of the Santo Domingo calendar day containing the instant. */
export function localDay(d: Date): string {
  return santoDomingoDateKey(d);
}

/** Local midnight of the first day of a `days`-day window ending today (Santo Domingo). */
export function windowStart(now: Date, days: number): Date {
  const local = santoDomingoWallClock(now);
  return santoDomingoInstant(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (days - 1));
}
```

If `LOCAL_OFFSET_MS` is used anywhere else in that file, replace it the same way; `grep -n LOCAL_OFFSET_MS` must print nothing afterwards.

`api/src/reports/report-render.ts`:
- delete the comment line and `const LOCAL_OFFSET_MS = 4 * 3_600_000;`;
- add `import { santoDomingoWallClock } from '../shared/santo-domingo';`;
- make `local` read:

```ts
function local(d: Date): Date {
  return santoDomingoWallClock(d);
}
```

`api/src/recurring/due-occurrences.ts`: add `import { SANTO_DOMINGO_OFFSET_HOURS } from '../shared/santo-domingo';` and replace the constant with:

```ts
/** 08:00 America/Santo_Domingo, as a UTC hour. */
export const DUE_HOUR_UTC = 8 + SANTO_DOMINGO_OFFSET_HOURS;
```

`api/src/reports/report-periods.ts`: add `import { SANTO_DOMINGO_OFFSET_HOURS } from '../shared/santo-domingo';` and replace the two constants with:

```ts
/** 07:00 America/Santo_Domingo, as a UTC hour. */
const DUE_HOUR_UTC = 7 + SANTO_DOMINGO_OFFSET_HOURS;
/** Local midnight in Santo Domingo, as a UTC hour. */
const LOCAL_MIDNIGHT_HOUR_UTC = SANTO_DOMINGO_OFFSET_HOURS;
```

- [ ] **Step 6: Run everything.**

Run: `cd api && npx jest && npx tsc --noEmit -p tsconfig.json && grep -rn "4 \* 3_600_000" src --include=*.ts | grep -v spec`
Expected: all tests pass, `tsc` prints nothing, and the grep finds only `src/shared/santo-domingo.ts` (written as `SANTO_DOMINGO_OFFSET_HOURS * 3_600_000`), so it prints nothing.

- [ ] **Step 7: Commit.**

```bash
git add api/src/shared/santo-domingo.ts api/src/shared/santo-domingo.spec.ts api/src/ingestion/parsers/dates.ts api/src/ingestion/parsers/dates.spec.ts api/src/balance/daily-closings.ts api/src/reports/report-render.ts api/src/recurring/due-occurrences.ts api/src/reports/report-periods.ts
git commit -m "fix(api): bank-mail times are Santo Domingo time whatever TZ says; one UTC−4 helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cash usage and the counter repair

**Files:**
- Modify: `api/src/categories/category-references.service.ts`, `api/src/categories/category-references.service.spec.ts`
- Modify: `api/src/cash/cash.service.ts`, `api/src/cash/cash.service.spec.ts`

- [ ] **Step 1: Write the failing usage tests.** In `category-references.service.spec.ts`:
- add `select: jest.fn(() => q),` to the object in the `query()` helper, so it reads `const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };`;
- give `txModel` a `find` mock: type `{ aggregate: jest.Mock; updateMany: jest.Mock; find: jest.Mock }`, value `{ aggregate: …, updateMany: …, find: jest.fn(() => query([])) }`;
- give `itemModel` a `distinct` mock: type `{ aggregate: jest.Mock; updateMany: jest.Mock; distinct: jest.Mock }`, value `{ …, distinct: jest.fn().mockResolvedValue([]) }`;
- in the existing usage test, change the item expectation to `expect(itemModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, withdrawalId: { $in: [] } } });`;
- add these tests after it:

```ts
  it('counts only the cash items of withdrawals that still exist', async () => {
    const LIVE = '64b0000000000000000000a1';
    const GONE = '64b0000000000000000000a2';
    itemModel.distinct.mockResolvedValue([LIVE, GONE, 'not-an-id']);
    const live = query([{ _id: LIVE }]);
    txModel.find.mockReturnValue(live);
    itemModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 3 }]);
    const usage = await service.usage();
    expect(usage.get('gym')!.cashItems).toBe(3);
    expect(itemModel.distinct).toHaveBeenCalledWith('withdrawalId', { userId: 1 });
    expect(txModel.find).toHaveBeenCalledWith({ _id: { $in: [LIVE, GONE] }, userId: 1, deletedAt: null });
    expect(live.select).toHaveBeenCalledWith('_id');
    expect(itemModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, withdrawalId: { $in: [LIVE] } } });
  });

  it('looks up no withdrawals when there are no cash items', async () => {
    await service.usage();
    expect(txModel.find).not.toHaveBeenCalled();
  });
```

The existing "moves cash items" test stays as it is: `migrate()` still moves every item.

- [ ] **Step 2: Write the failing repair tests.** In `cash.service.spec.ts`:
- add `Logger` to the `@nestjs/common` import;
- in `'refuses more than is left, naming what is left, and records nothing'`, add `itemModel.find.mockReturnValue(query([{ amount: 3000 }, { amount: 1500 }])); // the counter (4500) is right` after the first line, and `expect(txModel.updateOne).not.toHaveBeenCalled();` at the end;
- in `'is a 404 for a missing or deleted withdrawal'` and in the `it.each` `'refuses to itemize %s'`, change `txModel.findOne.mockReturnValueOnce(` to `txModel.findOne.mockReturnValue(`. A refused add now reads the row twice (repair, then the reason), and the row must stay what the test says it is. In the `it.each` also add `expect(txModel.updateOne).not.toHaveBeenCalled();`;
- add this block inside `describe('add', …)`:

```ts
    describe('a counter left high', () => {
      it('is corrected from the items, and the add goes through', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        txModel.findOneAndUpdate.mockResolvedValueOnce(null); // refused: the counter says 4500 of 5000 is taken…
        itemModel.find.mockReturnValue(query([{ amount: 3000 }])); // …but the items hold only 3000
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
        await expect(service.add(W, { category: 'food', amount: 600 })).resolves.toEqual({ id: ITEM });
        expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1, allocatedCash: 4500 }, { $set: { allocatedCash: 3000 } });
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(itemModel.create).toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('4500'));
        warn.mockRestore();
      });

      it('is left alone when it matches the items: the usual refusal', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 4500 }]));
        await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
        expect(txModel.updateOne).not.toHaveBeenCalled();
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      });

      it('is not retried when something else changed it first', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 3000 }]));
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
        await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      });

      it('is repaired at most once: a second refusal is final', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        txModel.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 3000 }]));
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
        await expect(service.add(W, { category: 'food', amount: 2500 })).rejects.toThrow(BadRequestException);
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(txModel.updateOne).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });
    });
```

- [ ] **Step 3: Run them and watch them fail.**

Run: `cd api && npx jest src/categories/category-references.service.spec.ts src/cash/cash.service.spec.ts`
Expected: the new usage tests fail (`distinct` isn't called), and the "corrected from the items" test fails (the add is refused).

- [ ] **Step 4: Implement usage.** In `category-references.service.ts`, change the mongoose import to `import { Model, Types } from 'mongoose';`. Replace the items entry in `usage()`'s `Promise.all`, which is `this.itemModel.aggregate([{ $match: { userId: this.userId } }, ...byCategory]),`, with:

```ts
      this.liveWithdrawalIds().then((ids) =>
        this.itemModel.aggregate([{ $match: { userId: this.userId, withdrawalId: { $in: ids } } }, ...byCategory]),
      ),
```

Add this private method after `usage()`:

```ts
  /**
   * Withdrawals that still exist. Items of a deleted withdrawal show nowhere, so they
   * aren't counted as uses; migrate() still moves them, so nothing names a dead category.
   */
  private async liveWithdrawalIds(): Promise<string[]> {
    const ids = (await this.itemModel.distinct('withdrawalId', { userId: this.userId })) as string[];
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return [];
    const live = await this.txModel.find({ _id: { $in: valid }, userId: this.userId, ...NOT_DELETED }).select('_id').lean();
    return live.map((t) => String(t._id));
  }
```

- [ ] **Step 5: Implement the repair.** In `cash.service.ts`, replace the reservation in `add()` (the `const reserved = await this.txModel.findOneAndUpdate(…);` statement and the `if (!reserved) throw …` line) with:

```ts
    // Reserve first, in one guarded write. The counter only grows while it stays
    // within the withdrawal, so two concurrent adds can't both fit into the same remainder.
    let reserved = await this.reserve(withdrawalId, amount);
    // A refusal can come from a counter left high by an earlier failure: repair it once and retry.
    if (!reserved && (await this.repairCounter(withdrawalId))) reserved = await this.reserve(withdrawalId, amount);
    if (!reserved) throw await this.whyNotReserved(withdrawalId);
```

Add these private methods right after `add()`:

```ts
  /** The guarded reservation: grows the counter by `amount` only while it stays within the withdrawal. */
  private reserve(withdrawalId: string, amount: number) {
    return this.txModel.findOneAndUpdate(
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
  }

  /**
   * Lowers a counter left above its items (a crash between the reservation and the
   * insert, or an ambiguous insert error) to the items' sum, with a write guarded on
   * the value read. Returns true when it corrected one. Known limit: an add from
   * another tab that has reserved but not yet inserted, in the same milliseconds,
   * would be undercounted by its amount.
   */
  private async repairCounter(withdrawalId: string): Promise<boolean> {
    const tx = await this.txModel.findOne({ _id: withdrawalId, userId: this.userId, ...NOT_DELETED }).lean();
    if (!tx || !this.itemizable(tx)) return false;
    const items = await this.itemModel.find({ userId: this.userId, withdrawalId: String(tx._id) }).lean();
    const sum = round2(items.reduce((s, i) => s + i.amount, 0));
    const counter = tx.allocatedCash ?? 0;
    if (counter <= sum + HALF_CENT) return false;
    const res = await this.txModel.updateOne(
      { _id: tx._id, userId: this.userId, allocatedCash: tx.allocatedCash },
      { $set: { allocatedCash: sum } },
    );
    if (!res.modifiedCount) return false;
    this.logger.warn(`Withdrawal ${String(tx._id)}: itemized counter was ${counter} but its items sum to ${sum}; corrected`);
    return true;
  }
```

- [ ] **Step 6: Run the specs, then the suite.**

Run: `cd api && npx jest src/categories src/cash && npx jest`
Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add api/src/categories/category-references.service.ts api/src/categories/category-references.service.spec.ts api/src/cash/cash.service.ts api/src/cash/cash.service.spec.ts
git commit -m "fix(api): cash usage ignores deleted withdrawals; a counter left high is repaired when it blocks an add

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Unique active category names

**Files:**
- Modify: `api/src/shared/schemas/custom-category.schema.ts`, `api/src/shared/schemas/custom-category.schema.spec.ts`
- Modify: `api/src/categories/categories.service.ts`, `api/src/categories/categories.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** Add to `custom-category.schema.spec.ts`:

```ts
  // Two simultaneous creates or renames can both pass the service's name check;
  // the database must refuse the second. Deleted records may share a name.
  it('keeps active names unique per user', () => {
    expect(CustomCategorySchema.indexes()).toContainEqual([
      { userId: 1, name: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { active: true } }),
    ]);
  });
```

Add to `categories.service.spec.ts`, at the end of the outer `describe`:

```ts
  describe('a name lost to a simultaneous write', () => {
    const duplicate = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

    it('answers 409 when a create loses the race', async () => {
      model.create.mockRejectedValueOnce(duplicate());
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toThrow(
        new ConflictException('You already have a category called gym'),
      );
    });

    it('answers 409 when a revive loses the race, and creates nothing', async () => {
      model.findOneAndUpdate.mockRejectedValueOnce(duplicate());
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toBeInstanceOf(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('answers 409 when a rename loses the race, and moves nothing', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      model.findOneAndUpdate.mockRejectedValueOnce(duplicate());
      const err = await service.update(ID, { name: 'fitness' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toMatch(/fitness already exists .* delete gym and move it there to merge/);
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('passes any other database failure on', async () => {
      const failure = new Error('db down');
      model.create.mockRejectedValueOnce(failure);
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toBe(failure);
    });
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/shared/schemas/custom-category.schema.spec.ts src/categories/categories.service.spec.ts`
Expected: the index test fails, and the three 409 tests fail (the raw error is thrown).

- [ ] **Step 3: Implement.** Append to `custom-category.schema.ts`, after the `SchemaFactory.createForClass` line:

```ts
// One active category per name. Deleted (inactive) records may share a name; a name
// deleted earlier comes back as the same record (CategoriesService.create), never a copy.
CustomCategorySchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { active: true } });
```

In `categories.service.ts`, add this private method before `assertNameFree`:

```ts
  /** The unique index on active names caught a race assertNameFree couldn't see: answer as it would have. */
  private async claimName<T>(write: PromiseLike<T>, takenMessage: string): Promise<T> {
    try {
      return await write;
    } catch (err) {
      if ((err as { code?: number } | null)?.code === 11000) throw new ConflictException(takenMessage);
      throw err;
    }
  }
```

In `create()`, replace the lines from `await this.assertNameFree(name, …)` through the `create` call with:

```ts
    const taken = `You already have a category called ${name}`;
    await this.assertNameFree(name, taken);

    // A name deleted earlier comes back as the same record, never a duplicate.
    const revived = await this.claimName(
      this.model.findOneAndUpdate(
        { userId: this.userId, name, active: false, pending: null },
        { $set: { active: true, emoji: input.emoji, color: input.color } },
        { sort: { _id: -1 }, new: true },
      ),
      taken,
    );
    if (revived) return { id: String(revived._id) };

    const created = await this.claimName(
      this.model.create({ userId: this.userId, name, emoji: input.emoji, color: input.color, active: true, pending: null }),
      taken,
    );
    return { id: String(created._id) };
```

In `update()`, replace the `assertNameFree` line and the `claimed` write with:

```ts
    const taken = `${to} already exists — delete ${cat.name} and move it there to merge`;
    await this.assertNameFree(to, taken);

    // The rename and the reservation of the old name are one write.
    const pending: Pending = { from: cat.name, to };
    const claimed = await this.claimName(
      this.model.findOneAndUpdate(
        { _id: cat._id, userId: this.userId, name: cat.name, active: true, pending: null },
        { $set: { ...set, name: to, pending } },
      ),
      taken,
    );
```

Leave the next line (`if (!claimed) throw new ConflictException(…)`) and everything after it unchanged.

- [ ] **Step 4: Run the specs, then the suite.**

Run: `cd api && npx jest src/categories src/shared/schemas && npx jest`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/shared/schemas/custom-category.schema.ts api/src/shared/schemas/custom-category.schema.spec.ts api/src/categories/categories.service.ts api/src/categories/categories.service.spec.ts
git commit -m "fix(api): active category names are unique in the database; a lost race answers 409

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Recurring day of month 1–28

**Files:**
- Modify: `api/src/shared/schemas/recurring.schema.ts`, `api/src/shared/schemas/recurring.schema.spec.ts`
- Modify: `api/src/recurring/due-occurrences.ts`, `api/src/recurring/due-occurrences.spec.ts`
- Modify: `api/src/recurring/recurring-scheduler.service.ts`, `api/src/recurring/recurring-scheduler.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** Add to `recurring.schema.spec.ts`. Put the imports at the top of the file and the tests inside its `describe`:

```ts
import { model } from 'mongoose';
import { TransactionType } from './transaction-type.enum';

const RecurringDayCheck = model('RecurringDayCheck', RecurringSchema);
const ruleOn = (dayOfMonth: unknown) =>
  new RecurringDayCheck({ userId: 1, userName: 'web', transactionName: 'rent', transactionType: TransactionType.EXPENSE, amount: 100, dayOfMonth });
```

```ts
  // planOccurrences assumes the day exists in every month; 29–31 would spill into the next one.
  it.each([1, 28])('accepts day %i', (day) => {
    expect(ruleOn(day).validateSync()).toBeUndefined();
  });

  it.each([0, 29, 1.5])('rejects day %p', (day) => {
    expect(ruleOn(day).validateSync()?.errors.dayOfMonth).toBeDefined();
  });
```

Add to `due-occurrences.spec.ts` (and add `isSchedulableDay` to its import from `./due-occurrences`):

```ts
describe('isSchedulableDay', () => {
  it.each([1, 15, 28])('accepts %i', (day) => expect(isSchedulableDay(day)).toBe(true));
  it.each([0, 29, 31, 1.5, NaN, '5', undefined])('rejects %p', (day) => expect(isSchedulableDay(day)).toBe(false));
});
```

Add to `recurring-scheduler.service.spec.ts`, inside `describe('sweep', …)`:

```ts
    it('skips a rule whose day of month is outside 1..28, warns, and books the others', async () => {
      const odd = makeRule({ transactionName: 'odd', dayOfMonth: 31, lastPeriod: '2026-08' });
      const loan = makeRule({ transactionName: 'loan', lastPeriod: '2026-08' });
      recurringModel.find.mockResolvedValue([odd, loan]);
      await service.sweep(NOW);
      expect(txModel.create).toHaveBeenCalledTimes(1);
      expect(txModel.create).toHaveBeenCalledWith(expect.objectContaining({ transactionName: 'loan' }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dayOfMonth 31'));
      expect(logSpy).toHaveBeenCalledWith(summary(1, 0, 0, 0));
    });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/shared/schemas/recurring.schema.spec.ts src/recurring`
Expected: the schema rejects nothing, `isSchedulableDay` isn't exported, and the sweep books the day-31 rule.

- [ ] **Step 3: Implement.** In `recurring.schema.ts`, replace the `dayOfMonth` line with:

```ts
  /** 1..28, so the day exists in every month (the sweep relies on it). */
  @Prop({
    required: true,
    min: 1,
    max: 28,
    validate: { validator: Number.isInteger, message: 'dayOfMonth must be a whole number' },
  })
  dayOfMonth: number;
```

In `due-occurrences.ts`, add after `LOOKBACK_DAYS`:

```ts
/** A day every month has. Rules are bounded to 1..28 so an occurrence never spills into the next month. */
export function isSchedulableDay(day: unknown): boolean {
  return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28;
}
```

In `recurring-scheduler.service.ts`, add `isSchedulableDay` to the import from `./due-occurrences`, and make these the first lines of `processRule`:

```ts
    if (!isSchedulableDay(rule.dayOfMonth)) {
      this.logger.warn(
        `Recurring ${String(rule._id)} "${rule.transactionName}": dayOfMonth ${rule.dayOfMonth} is not a day from 1 to 28; not booked`,
      );
      return;
    }
```

- [ ] **Step 4: Run the specs, then the suite.**

Run: `cd api && npx jest src/recurring src/shared/schemas && npx jest`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/src/shared/schemas/recurring.schema.ts api/src/shared/schemas/recurring.schema.spec.ts api/src/recurring
git commit -m "fix(api): recurring day of month is 1–28 in the schema; the sweep skips a rule outside it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Five mail-check counts

**Files:**
- Modify: `api/src/ingestion/ingestion-status.service.ts`, `api/src/ingestion/ingestion-status.service.spec.ts`
- Modify: `api/src/shared/schemas/ingestion-status.schema.ts`
- Modify: `api/src/ingestion/ingestion.service.ts`, `api/src/ingestion/ingestion.service.spec.ts`
- Modify: `api/src/ingestion/ingestion.controller.spec.ts`
- Modify: `web/src/app/core/services/api.models.ts`, `web/src/app/pages/settings/mail-section/mail-section.component.ts`, `web/src/app/pages/settings/mail-section/mail-section.component.html`

- [ ] **Step 1: Change `RunCounts` and the status record.** In `ingestion-status.service.ts`, replace the `RunCounts` interface with:

```ts
/** What one ingestion run did with each mail it read. Every mail lands in exactly one count. */
export interface RunCounts {
  /** Booked this run. */
  created: number;
  /** Booked before (its message id is known), or a duplicate the database refused. */
  alreadyBooked: number;
  /** Dismissed on the Settings page, recognised as not a transaction, or from a sender no parser takes. */
  notTransactions: number;
  /** The parser couldn't use it; listed as unreadable on the Settings page. */
  unreadable: number;
  /** Read fine but the save failed; retried on the next poll. */
  bookingFailed: number;
}
```

In `recordRun`, make the `$set`:

```ts
        {
          $set: {
            lastRunAt: at,
            created: counts.created,
            alreadyBooked: counts.alreadyBooked,
            notTransactions: counts.notTransactions,
            unreadable: counts.unreadable,
            bookingFailed: counts.bookingFailed,
            lastError: null,
          },
        },
```

In the view builder, make `lastRun`:

```ts
      lastRun: status?.lastRunAt
        ? {
            at: status.lastRunAt,
            created: status.created ?? 0,
            alreadyBooked: status.alreadyBooked ?? 0,
            notTransactions: status.notTransactions ?? 0,
            unreadable: status.unreadable ?? 0,
            bookingFailed: status.bookingFailed ?? 0,
          }
        : null,
```

In `ingestion-status.schema.ts`, replace the `skipped` and `failed` props with:

```ts
  @Prop() alreadyBooked?: number;
  @Prop() notTransactions?: number;
  @Prop() unreadable?: number;
  @Prop() bookingFailed?: number;
```

A record written by the old version keeps its old `skipped`/`failed` values, which are no longer read. Its new counts read as 0 until the next poll overwrites the record.

- [ ] **Step 2: Count by kind in `run()`.** In `ingestion.service.ts`, import `RunCounts` from `./ingestion-status.service` if it isn't imported already, and change `run()`'s return type to `Promise<RunCounts>`. Replace `let created = 0, skipped = 0, failed = 0;` with:

```ts
    const counts: RunCounts = { created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0 };
```

In the loop:
- replace `if (known.has(mail.messageId) || dismissed.has(mail.messageId)) { skipped++; continue; }` with:

```ts
      if (known.has(mail.messageId)) { counts.alreadyBooked++; continue; }
      if (dismissed.has(mail.messageId)) { counts.notTransactions++; continue; }
```

- `if (!parser) { skipped++; continue; }` becomes `if (!parser) { counts.notTransactions++; continue; }`;
- in the non-transactional branch, `skipped++;` becomes `counts.notTransactions++;`;
- in the `!parsed` branch, `failed++;` becomes `counts.unreadable++;`;
- the three result lines become:

```ts
      if (result === 'created') counts.created++;
      else if (result === 'duplicate') counts.alreadyBooked++;
      else counts.bookingFailed++;
```

Replace the end of `run()` with:

```ts
    this.logger.log(
      `Ingestion run: created=${counts.created} alreadyBooked=${counts.alreadyBooked} ` +
        `notTransactions=${counts.notTransactions} unreadable=${counts.unreadable} bookingFailed=${counts.bookingFailed}`,
    );
    return counts;
```

Fix any other place in `api/src` that builds or reads `{ created, skipped, failed }` the same way: `grep -rn "skipped\|failed:" api/src --include=*.ts | grep -v spec`, but ignore log text such as "Ingestion poll skipped" and the recurring scheduler's own `Tally`.

- [ ] **Step 3: Update the specs to the new counts.** In `ingestion.service.spec.ts`, add near the top:

```ts
/** A run's counts, zero unless named. */
const counts = (over: Partial<Record<'created' | 'alreadyBooked' | 'notTransactions' | 'unreadable' | 'bookingFailed', number>> = {}) => ({
  created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, ...over,
});
```

Then replace every `{ created: X, skipped: Y, failed: Z }` expectation using the scenario of its test:
- `{ created: 1, skipped: 0, failed: 0 }` → `counts({ created: 1 })` (every booking test).
- `'counts a Mongo duplicate-key error as skipped, not failed, …'` → `counts({ alreadyBooked: 1 })`; rename it `'counts a Mongo duplicate-key error as already booked, not failed, and does not log an error'`.
- `'counts a non-duplicate persist error as failed …'` → `counts({ bookingFailed: 1 })`; rename it `'counts a non-duplicate persist error as a failed booking and logs an error'`.
- `'increments failed and logs a warning when the matched parser cannot parse the mail …'` → `counts({ unreadable: 1 })`; rename it `'counts a mail the parser cannot use as unreadable and logs a warning (never silently dropped)'`.
- `'does not abort the run when a parser throws …'` (`{ created: 1, skipped: 0, failed: 1 }`) → `counts({ created: 1, unreadable: 1 })`.
- `'skips a mail the user dismissed, before any parsing'` → `counts({ notTransactions: 1 })`.
- `'skips (without a matching parser) a mail whose sender is not registered to any parser'` → `counts({ notTransactions: 1 })`.
- `'counts a non-transactional email as skipped, not failed, and does not warn'` → `counts({ notTransactions: 1 })`; rename it `'counts a non-transactional email as not a transaction, and does not warn'`.
- All-zero expectations (`runGuarded`, the whole-run-failure test) → `counts()`, including `status.recordRun` toHaveBeenCalledWith.
- `'deletes the just-created row and reports failed when the ledger rejects'` → `counts({ bookingFailed: 1 })`.
- `'lets the next poll create the same mail again once the ledger works'`: first → `counts({ bookingFailed: 1 })`, second → `counts({ created: 1 })`.

Add this test next to the dismissed-mail test:

```ts
  it('puts every mail of a run in exactly one count', async () => {
    mail.fetchSince.mockResolvedValue([
      makeMail({ messageId: 'booked-before' }),
      makeMail({ messageId: 'dismissed' }),
      makeMail({ messageId: 'unknown-sender', sender: 'someone@else.example' }),
      makeMail({ messageId: 'unreadable', body: 'unreadable' }),
      makeMail({ messageId: 'new', body: 'new' }),
      makeMail({ messageId: 'save-fails', body: 'save-fails' }),
    ]);
    // The first find is the already-booked lookup (alreadyIngested).
    txModel.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ sourceMessageId: 'booked-before' }]) }),
    });
    status.dismissedAmong.mockResolvedValue(new Set(['dismissed']));
    parserParseMock.mockImplementation(({ body }: { body: string }) => (body === 'unreadable' ? null : makeParsed()));
    txModel.create
      .mockImplementationOnce((doc: any) => Promise.resolve({ _id: 'tx-id', ...doc }))
      .mockRejectedValueOnce(new Error('Mongo connection reset'));

    const result = await service.run();

    expect(result).toEqual(counts({ created: 1, alreadyBooked: 1, notTransactions: 2, unreadable: 1, bookingFailed: 1 }));
  });
```

If the mocks fight each other here (for example, `persist` makes another `txModel.find` call first), adjust the mocks minimally, keep the six mails and the expectation, and report what you changed.

In `ingestion-status.service.spec.ts`:
- `recordRun` input and expected `$set`: use `{ created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0 }`, and expect `$set: { lastRunAt: AT, created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0, lastError: null }`;
- the all-zero `recordRun` call becomes all five zeros;
- the view test stores `{ lastRunAt: AT, created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0, lastError: 'login refused', lastErrorAt: AT }` and expects `lastRun: { at: AT, created: 1, alreadyBooked: 2, notTransactions: 3, unreadable: 1, bookingFailed: 0 }`;
- add a test that an old record `{ lastRunAt: AT, created: 1, skipped: 5, failed: 2 }` reads as `lastRun: { at: AT, created: 1, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0 }`;
- the other zero record becomes the five zeros.

In `ingestion.controller.spec.ts`, use `{ created: 1, alreadyBooked: 2, notTransactions: 0, unreadable: 0, bookingFailed: 0 }` in both places.

- [ ] **Step 4: Run the api suite and the type check.**

Run: `cd api && npx jest && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and `tsc` prints nothing.

- [ ] **Step 5: Web.** In `web/src/app/core/services/api.models.ts`, replace `RunCounts` with:

```ts
/** What one mail check did with each mail it read. */
export interface RunCounts {
  created: number;
  alreadyBooked: number;
  notTransactions: number;
  unreadable: number;
  bookingFailed: number;
}
```

In `mail-section.component.ts`, add above the `@Component` decorator:

```ts
/** "1 new · 140 already booked · 12 not transactions": "new" always, the rest only when above zero. */
function countsText(c: RunCounts): string {
  const parts = [`${c.created} new`];
  if (c.alreadyBooked > 0) parts.push(`${c.alreadyBooked} already booked`);
  if (c.notTransactions > 0) parts.push(`${c.notTransactions} not ${c.notTransactions === 1 ? 'a transaction' : 'transactions'}`);
  if (c.unreadable > 0) parts.push(`${c.unreadable} couldn't read`);
  if (c.bookingFailed > 0) parts.push(`${c.bookingFailed} couldn't book`);
  return parts.join(' · ');
}
```

Add `readonly countsText = countsText;` as a class field, and change the check result line to:

```ts
          this.checkResult = `Checked: ${countsText(c)}.`;
```

In `mail-section.component.html`, replace the "Last checked …" line with:

```html
        Last checked {{ run.at | date: 'MMM d, h:mm a' }} · {{ countsText(run) }}
```

Run: `cd web && npx ng build`
Expected: "Application bundle generation complete." with no errors.

- [ ] **Step 6: Commit.**

```bash
git add api/src/ingestion api/src/shared/schemas/ingestion-status.schema.ts web/src/app/core/services/api.models.ts web/src/app/pages/settings/mail-section
git commit -m "feat: mail checks count new, already booked, not transactions, unreadable and failed bookings apart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-word own-name fragments

**Files:**
- Modify: `api/src/ingestion/parsers/own-party.ts`, `api/src/ingestion/parsers/own-party.spec.ts`
- Modify: `web/src/app/pages/settings/accounts-section/accounts-section.component.html`

- [ ] **Step 1: Write the failing tests.** Add inside `describe('matchesOwn', …)` in `own-party.spec.ts`:

```ts
  // A fragment matching inside a longer name would turn a stranger's transfer
  // into one of the user's own, and take it out of spending.
  describe('name fragments match whole words only', () => {
    it('matches a whole word, or a run of words', () => {
      expect(matchesOwn('JUAN RIVERA MARTE', ['rivera'])).toBe(true);
      expect(matchesOwn('Transferencia de JUAN ANTONIO RIVERA', ['juan antonio'])).toBe(true);
      expect(matchesOwn('RIVERA, JUAN', ['rivera'])).toBe(true);
    });

    it('does not match inside a longer word', () => {
      expect(matchesOwn('RIVERAS', ['rivera'])).toBe(false);
      expect(matchesOwn('MARIANA GOMEZ', ['ana'])).toBe(false);
      expect(matchesOwn('SANTANA', ['ana'])).toBe(false);
    });

    it('treats accented letters as letters', () => {
      expect(matchesOwn('PEDRO NÚÑEZ', ['núñez'])).toBe(true);
      expect(matchesOwn('PEDRO NÚÑEZA', ['núñez'])).toBe(false);
    });

    it('tolerates extra spaces between the words of a fragment', () => {
      expect(matchesOwn('JUAN   ANTONIO RIVERA', ['juan antonio'])).toBe(true);
    });

    it('takes regex characters in a fragment literally', () => {
      expect(matchesOwn('A.B SERVICES', ['a.b'])).toBe(true);
      expect(matchesOwn('AXB SERVICES', ['a.b'])).toBe(false);
    });
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd api && npx jest src/ingestion/parsers/own-party.spec.ts`
Expected: "does not match inside a longer word", the accented-letter case, the extra-spaces case and the literal `a.b` case all fail.

- [ ] **Step 3: Implement.** In `own-party.ts`, update the doc comment and the function:

```ts
/** Escapes regex metacharacters so a fragment is matched literally. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `value` refers to one of the caller's own identifiers.
 *
 * Numeric identifiers (account last-4) must match on a digit boundary, so
 * '2002' does not match an unrelated account ending '32002'. Getting this
 * wrong silently flips a transfer's classification and erases real money
 * from the ledger.
 *
 * Name fragments match whole words only (Unicode letters and digits bound a
 * word), so "ana" does not match inside "MARIANA". Words inside a fragment
 * may be separated by any run of whitespace.
 */
export function matchesOwn(value: string | null | undefined, ownIdentifiers: string[]): boolean {
  if (!value) return false;
  const hay = value.toLowerCase();
  return ownIdentifiers.some((raw) => {
    const id = raw.trim().toLowerCase();
    if (!id) return false;
    if (/^\d+$/.test(id)) {
      return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(hay);
    }
    const words = id.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'u').test(hay);
  });
}
```

- [ ] **Step 4: Settings text.** In `accounts-section.component.html`, replace:

```html
    <h3 id="senders-title">How you appear as a sender (last 4 digits or part of your name)</h3>
    <p class="set-muted">Used to recognise transfers you send.</p>
```

with:

```html
    <h3 id="senders-title">How you appear as a sender (last 4 digits or a whole word of your name)</h3>
    <p class="set-muted">Used to recognise transfers you send. A name matches whole words only: "rivera" matches "JUAN RIVERA", not "RIVERAS".</p>
```

- [ ] **Step 5: Run the parser suites, the whole suite, and the web build.**

Run: `cd api && npx jest src/ingestion && npx jest && cd ../web && npx ng build`
Expected: all tests pass (the Banreservas, BHD and Popular parser suites unchanged), and the build is clean.

- [ ] **Step 6: Commit.**

```bash
git add api/src/ingestion/parsers/own-party.ts api/src/ingestion/parsers/own-party.spec.ts web/src/app/pages/settings/accounts-section/accounts-section.component.html
git commit -m "fix: own-name fragments match whole words only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller checklist (after all tasks)

1. `cd api && npx jest` (note the counts), `npx tsc --noEmit -p tsconfig.json`; `cd web && npx ng build`.
2. Final review of the whole range; fix anything it finds.
3. PII gate on the diff and on the commit messages.
4. Append "As built" and "Follow-ups" to this plan. The follow-ups include the amount-edit path, which doesn't repair a high counter.
5. Update the memory file, push, watch CI, then give the user the restart command.
6. Tell the user to check the api log once after the restart for an index error on `customcategories`. Two active categories sharing a name would block the unique index; in that case they delete one on the Categories page and restart again.
