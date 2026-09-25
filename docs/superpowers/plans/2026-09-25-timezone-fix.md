# Time Zone Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The api runs in America/Santo_Domingo, and mail-sourced transactions already stored 4 hours early are corrected once.

**Architecture:**
- **The zone.** `TZ` is set in the api image. Tests always run in the same zone.
- **Zone-sensitive code.** The two places that would misbehave under the new zone are fixed: the Transactions date filter and Compare's month grouping.
- **Mail rows.** They are marked `mailTimeLocal`. A bootstrap-time `MailTimeBackfillService` shifts the older, unmarked mail rows by 4 hours exactly once, guarded by a `Migration` marker.

**Tech Stack:** NestJS 10, Mongoose 8, Jest, pnpm, Docker (`node:20-alpine`).

**Spec:** `docs/superpowers/specs/2026-09-25-timezone-fix-design.md`.

---

## Ground rules for every task

- **Paths.** Repo root: `C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot`. Use Git Bash, and `cd` with an absolute path in every command.
- **Branch.** Work on `main`. **Never push, amend, rebase or reset.** Stage with `git add <explicit paths>` only.
- **Commits.** Every message ends with a blank line and exactly one trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo.** Generic test data only.
- **Baseline.** Before Task 1, the api has **57 suites / 615 tests**, all passing. Report the exact counts after each task.

---

### Task 1: Tests run in the user's zone; a helper names the server's zone

**Files:**
- Create: `api/jest.timezone.js`
- Modify: `api/package.json` (the `jest` block)
- Create: `api/src/shared/time-zone.ts` and `api/src/shared/time-zone.spec.ts`
- Modify: `api/src/ingestion/parsers/dates.spec.ts`

- [ ] **Step 1: Write the failing tests**

`api/src/shared/time-zone.spec.ts`:
```ts
import { localDayEnd, localDayStart, serverTimeZone } from './time-zone';

// Every test runs in the user's zone (jest.timezone.js), the same as the api image.
describe('the server time zone', () => {
  it('is America/Santo_Domingo in tests, as in production', () => {
    expect(serverTimeZone()).toBe('America/Santo_Domingo');
    expect(new Date(2026, 0, 1).toISOString()).toBe('2026-01-01T04:00:00.000Z');
  });

  it("reads a YYYY-MM-DD as that calendar day in the user's zone, start and end inclusive", () => {
    expect(localDayStart('2026-09-01').toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(localDayEnd('2026-09-30').toISOString()).toBe('2026-10-01T03:59:59.999Z');
  });

  it.each(['2026-9-1', 'sept', '', '2026-09-01T00:00'])('returns null for the malformed day %p', (day) => {
    expect(localDayStart(day)).toBeNull();
    expect(localDayEnd(day)).toBeNull();
  });
});
```
Append to `dates.spec.ts` (import `parseDdMmYyyy12h` if it isn't imported yet):
```ts
describe('bank times are read in the user zone', () => {
  it('stores a BHD "09:53 pm" as the true instant', () => {
    expect(parseDdMmYyyy12h('24/09/2026 09:53 pm')!.toISOString()).toBe('2026-09-25T01:53:00.000Z');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- time-zone dates 2>&1 | tail -12
```
Expected:
- `time-zone.spec` fails to compile, because there's no module yet;
- the `dates.spec` test fails unless your machine happens to be in UTC−4.

- [ ] **Step 3: Implement**

`api/jest.timezone.js`:
```js
// Jest global setup: every test runs in the user's zone, the same as the api image
// (ENV TZ in api/Dockerfile). Workers start after this and inherit it.
module.exports = async () => {
  process.env.TZ = 'America/Santo_Domingo';
};
```
In `package.json`'s `jest` block, add `"globalSetup": "<rootDir>/../jest.timezone.js",` (`rootDir` is `src`).

`api/src/shared/time-zone.ts`:
```ts
/**
 * The api runs in the user's zone (ENV TZ=America/Santo_Domingo in the Dockerfile;
 * UTC−4 all year, no DST), so server-local months and days are the user's own.
 */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → 00:00:00.000 of that calendar day in the server's zone, or null when malformed. */
export function localDayStart(day: string): Date | null {
  const m = DAY.exec(day);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** 'YYYY-MM-DD' → 23:59:59.999 of that calendar day in the server's zone, or null when malformed. */
export function localDayEnd(day: string): Date | null {
  const m = DAY.exec(day);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : null;
}
```

- [ ] **Step 4: Run the whole suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: everything passes, about **58 suites / 622 tests**. If an existing test fails only because the zone changed, stop and report it: it would mean that test depended on the machine's zone.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/jest.timezone.js api/package.json api/src/shared/time-zone.ts api/src/shared/time-zone.spec.ts api/src/ingestion/parsers/dates.spec.ts
git commit -F- <<'EOF'
test(api): run every test in the user's time zone, as production will

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The Transactions date filter reads local days

**Files:**
- Modify: `api/src/transactions/transactions.service.ts` (`buildFilter`)
- Test: `api/src/transactions/transactions.service.spec.ts`

- [ ] **Step 1: Write the failing tests** (in `describe('findAll')`)

```ts
    it("filters by whole calendar days in the user's zone", async () => {
      await service.findAll({ startDate: '2026-09-01', endDate: '2026-09-30' });
      const [filter] = mockModel.find.mock.calls[0] as any[];
      expect(filter.timestamp.$gte.toISOString()).toBe('2026-09-01T04:00:00.000Z');
      expect(filter.timestamp.$lte.toISOString()).toBe('2026-10-01T03:59:59.999Z');
    });

    it('refuses a malformed date', async () => {
      await expect(service.findAll({ startDate: 'sept' })).rejects.toThrow(BadRequestException);
      await expect(service.findAll({ endDate: '2026-9-30' })).rejects.toThrow(BadRequestException);
    });
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- transactions.service 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 3: Implement**

In `buildFilter`, replace the `startDate`/`endDate` block with:
```ts
    if (query.startDate || query.endDate) {
      // The page sends calendar days (YYYY-MM-DD) in the user's zone; new Date('YYYY-MM-DD')
      // would read them as UTC midnight and, in the user's zone, drop the whole end day.
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = this.day(localDayStart, query.startDate, 'startDate');
      if (query.endDate) filter.timestamp.$lte = this.day(localDayEnd, query.endDate, 'endDate');
    }
```
and add a private helper to the class:
```ts
  private day(read: (day: string) => Date | null, value: string, name: string): Date {
    const date = read(value);
    if (!date) throw new BadRequestException(`${name} must be a date like 2026-09-30 (got ${value})`);
    return date;
  }
```
Import `localDayStart` and `localDayEnd` from `'../shared/time-zone'`. If `buildFilter` is a standalone function rather than a method, adapt the helper minimally and report it.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/transactions/transactions.service.ts api/src/transactions/transactions.service.spec.ts
git commit -F- <<'EOF'
fix(api): the Transactions date filter covers whole days in the user's zone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Compare groups months in the server's zone

**Files:**
- Modify: `api/src/compare/compare.service.ts` (`getAvailableMonths`)
- Test: `api/src/compare/compare.service.spec.ts`

- [ ] **Step 1: Write the failing test** (in `describe('getAvailableMonths')`)

```ts
    // The periods it offers are then queried with server-local month boundaries: group the same way.
    it("groups months in the server's zone", async () => {
      await service.getAvailableMonths();
      const pipeline = mockModel.aggregate.mock.calls[0][0];
      expect(pipeline[1].$group._id).toEqual({
        year: { $year: { date: '$timestamp', timezone: 'America/Santo_Domingo' } },
        month: { $month: { date: '$timestamp', timezone: 'America/Santo_Domingo' } },
      });
    });
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- compare 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 3: Implement**

Import `serverTimeZone` from `'../shared/time-zone'`, and in `getAvailableMonths` change the `$group` to:
```ts
      {
        $group: {
          _id: {
            year: { $year: { date: '$timestamp', timezone: serverTimeZone() } },
            month: { $month: { date: '$timestamp', timezone: serverTimeZone() } },
          },
        },
      },
```

- [ ] **Step 4: Run the suite, then commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/compare/compare.service.ts api/src/compare/compare.service.spec.ts
git commit -F- <<'EOF'
fix(api): Compare's month list uses the same zone as the months it compares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Mark mail rows; correct the old ones once; set the zone in the image

**Files:**
- Modify: `api/src/shared/schemas/transaction.schema.ts` (+ its spec)
- Create: `api/src/shared/schemas/migration.schema.ts` (+ spec)
- Modify: `api/src/ingestion/ingestion.service.ts` (+ spec)
- Create: `api/src/ingestion/mail-time-backfill.service.ts` (+ spec)
- Modify: `api/src/ingestion/ingestion.module.ts`
- Modify: `api/Dockerfile`

- [ ] **Step 1: Write the failing tests**

- **`transaction.schema.spec.ts`,** in `describe('TransactionSchema fields')`:
```ts
  it('declares mailTimeLocal: this row's time was read in the user's zone', () => {
    expect(TransactionSchema.path('mailTimeLocal')).toBeDefined();
  });
```
  If a single quote inside the test name breaks the string, use double quotes.
- **`migration.schema.spec.ts`:**
```ts
import { MigrationSchema } from './migration.schema';

describe('MigrationSchema', () => {
  // One marker per one-time job: the database guarantees two pods can't both start it fresh.
  it('declares a unique index on name', () => {
    expect(MigrationSchema.indexes()).toContainEqual([{ name: 1 }, expect.objectContaining({ unique: true })]);
  });
});
```
- **`ingestion.service.spec.ts`:**
  - In `'records an expense as a negative signed amount…'`, add `expect(created.mailTimeLocal).toBe(true);`.
  - In `'keeps isWithdrawal when confirming a predicted recurring transaction in place'`, or the confirm-in-place test, add an assertion that the saved prediction has `mailTimeLocal === true`, following how that test inspects the prediction.
- **`mail-time-backfill.service.spec.ts`:**
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { BACKFILL_NAME, MailTimeBackfillService } from './mail-time-backfill.service';
import { Migration } from '../shared/schemas/migration.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

const lean = (v: unknown) => ({ lean: jest.fn().mockResolvedValue(v) });
const START = new Date('2026-09-25T18:00:00Z');

describe('MailTimeBackfillService', () => {
  let service: MailTimeBackfillService;
  let migrationModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock };
  let collection: { updateMany: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    migrationModel = {
      findOneAndUpdate: jest.fn(() => lean({ name: BACKFILL_NAME, cutoff: START })),
      findOne: jest.fn(() => lean(null)),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    collection = { updateMany: jest.fn().mockResolvedValue({ modifiedCount: 7 }) };
    const mod = await Test.createTestingModule({
      providers: [
        MailTimeBackfillService,
        { provide: getModelToken(Migration.name), useValue: migrationModel },
        { provide: getModelToken(Transaction.name), useValue: { collection } },
      ],
    }).compile();
    service = mod.get(MailTimeBackfillService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('does nothing unless the server runs in the user zone', async () => {
    await expect(service.run(START, 'UTC')).resolves.toBe(0);
    expect(migrationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(collection.updateMany).not.toHaveBeenCalled();
  });

  it('fixes the cut-off at the first start, then shifts every unmarked mail row from before it by 4 hours, once', async () => {
    await expect(service.run(START)).resolves.toBe(7);
    expect(migrationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { name: BACKFILL_NAME },
      { $setOnInsert: { name: BACKFILL_NAME, cutoff: START } },
      { upsert: true, new: true },
    );
    expect(collection.updateMany).toHaveBeenCalledWith(
      {
        sourceMessageId: { $exists: true },
        _id: { $lt: Types.ObjectId.createFromTime(Math.floor(START.getTime() / 1000)) },
        mailTimeLocal: { $ne: true },
      },
      [{ $set: { timestamp: { $add: ['$timestamp', 4 * 3_600_000] }, mailTimeLocal: true } }],
    );
    expect(migrationModel.updateOne).toHaveBeenCalledWith({ name: BACKFILL_NAME }, { $set: { doneAt: START, shifted: 7 } });
  });

  it('does nothing once the correction is done', async () => {
    migrationModel.findOneAndUpdate.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: START, doneAt: START }));
    await expect(service.run(new Date('2026-10-01T00:00:00Z'))).resolves.toBe(0);
    expect(collection.updateMany).not.toHaveBeenCalled();
  });

  it('reuses the first cut-off when an earlier run did not finish', async () => {
    const earlier = new Date('2026-09-25T12:00:00Z');
    migrationModel.findOneAndUpdate.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: earlier }));
    await service.run(START);
    expect(collection.updateMany.mock.calls[0][0]._id).toEqual({
      $lt: Types.ObjectId.createFromTime(Math.floor(earlier.getTime() / 1000)),
    });
  });

  it('re-reads the marker when another pod created it at the same moment', async () => {
    migrationModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue({ code: 11000 }) });
    migrationModel.findOne.mockReturnValue(lean({ name: BACKFILL_NAME, cutoff: START, doneAt: START }));
    await expect(service.run(START)).resolves.toBe(0);
    expect(migrationModel.findOne).toHaveBeenCalledWith({ name: BACKFILL_NAME });
  });

  it('never fails the start: a failure is logged and retried on the next start', async () => {
    collection.updateMany.mockRejectedValue(new Error('db down'));
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- migration mail-time transaction.schema ingestion.service 2>&1 | grep -E "✕|Tests:|Cannot find"
```

- [ ] **Step 3: Implement**

**`transaction.schema.ts`:** after `allocatedCash`, add:
```ts

  /**
   * This row's time was read in the user's zone. Set on every row the ingester writes;
   * rows read before the api ran in America/Santo_Domingo were 4 hours early until
   * MailTimeBackfillService corrected them and set this.
   */
  @Prop() mailTimeLocal?: boolean;
```

**`migration.schema.ts`:**
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** A one-time data correction: its cut-off, and when it finished. */
@Schema()
export class Migration extends Document {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) cutoff: Date;
  @Prop() doneAt?: Date;
  @Prop() shifted?: number;
}

export const MigrationSchema = SchemaFactory.createForClass(Migration);

MigrationSchema.index({ name: 1 }, { unique: true });
```

**`ingestion.service.ts`:**
- In the `txModel.create({ … })` object, add `mailTimeLocal: true,`.
- In the confirm-in-place branch, next to `predicted.isWithdrawal = p.isWithdrawal;`, add `predicted.mailTimeLocal = true;`.

**`mail-time-backfill.service.ts`:**
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Migration } from '../shared/schemas/migration.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { serverTimeZone } from '../shared/time-zone';

export const BACKFILL_NAME = 'mail-times-to-santo-domingo';
const USER_ZONE = 'America/Santo_Domingo';
/** Santo Domingo is UTC−4 all year; the Dominican Republic has no DST. */
const SHIFT_MS = 4 * 3_600_000;

/**
 * Bank-mail times were read as if they were UTC until the api ran in the user's
 * zone, so every mail-sourced row booked before then is exactly 4 hours early.
 * On the first start in the right zone this shifts each such row once. Every
 * shifted row is marked, so a crash, a retry or two pods starting together
 * never shift a row twice. Balances are untouched: only `timestamp` moves.
 */
@Injectable()
export class MailTimeBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailTimeBackfillService.name);

  constructor(
    @InjectModel(Migration.name) private readonly migrationModel: Model<Migration>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  onApplicationBootstrap(): void {
    // In the background: a slow or failed correction never holds up or fails the start.
    this.run(new Date()).catch((err) =>
      this.logger.error('Mail-time correction failed; it runs again on the next start', err instanceof Error ? err.stack : String(err)),
    );
  }

  async run(now: Date, zone: string = serverTimeZone()): Promise<number> {
    if (zone !== USER_ZONE) {
      this.logger.warn(`Mail-time correction skipped: the server runs in ${zone}, not ${USER_ZONE}`);
      return 0;
    }
    const marker = await this.claim(now);
    if (!marker || marker.doneAt) return 0;

    const cutoff = Types.ObjectId.createFromTime(Math.floor(new Date(marker.cutoff).getTime() / 1000));
    // The raw collection: mailTimeLocal is set inside an update pipeline, which Mongoose doesn't cast.
    const res = await this.txModel.collection.updateMany(
      { sourceMessageId: { $exists: true }, _id: { $lt: cutoff }, mailTimeLocal: { $ne: true } },
      [{ $set: { timestamp: { $add: ['$timestamp', SHIFT_MS] }, mailTimeLocal: true } }],
    );
    await this.migrationModel.updateOne({ name: BACKFILL_NAME }, { $set: { doneAt: now, shifted: res.modifiedCount } });
    this.logger.log(`Mail-time correction: moved ${res.modifiedCount} mail-sourced transactions 4 hours later`);
    return res.modifiedCount;
  }

  /** The marker, created with this start as its cut-off if it doesn't exist yet. */
  private async claim(now: Date): Promise<{ cutoff: Date; doneAt?: Date } | null> {
    try {
      return await this.migrationModel
        .findOneAndUpdate({ name: BACKFILL_NAME }, { $setOnInsert: { name: BACKFILL_NAME, cutoff: now } }, { upsert: true, new: true })
        .lean();
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      return this.migrationModel.findOne({ name: BACKFILL_NAME }).lean(); // another pod created it at the same moment
    }
  }
}
```

**`ingestion.module.ts`:** add `{ name: Migration.name, schema: MigrationSchema }` to `forFeature`, and `MailTimeBackfillService` to `providers`, with the imports.

**`api/Dockerfile`:** in the runtime stage (the second `FROM node:20-alpine`), right after that `FROM` line, add:
```dockerfile
# The user's zone: server-local months and days, and bank-mail times, are Santo Domingo's
# (UTC−4 all year, no DST). tzdata backs TZ; Node's bundled ICU would usually suffice.
RUN apk add --no-cache tzdata
ENV TZ=America/Santo_Domingo
```

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Everything must pass, and the build must be clean. Report the counts.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/transaction.schema.ts api/src/shared/schemas/transaction.schema.spec.ts api/src/shared/schemas/migration.schema.ts api/src/shared/schemas/migration.schema.spec.ts api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts api/src/ingestion/mail-time-backfill.service.ts api/src/ingestion/mail-time-backfill.service.spec.ts api/src/ingestion/ingestion.module.ts api/Dockerfile
git commit -F- <<'EOF'
fix(api): run in the user's time zone and correct mail times stored 4 hours early

The api image sets TZ=America/Santo_Domingo, so months, days and bank-mail
times are the user's own. Mail rows now carry mailTimeLocal; on the first
start in the right zone, older unmarked mail rows move 4 hours later,
once, behind a Migration marker (retries and concurrent pods can't shift
a row twice). Balances are untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: README and final checks

- [ ] **Step 1:** In `README.md`, near the deployment or configuration notes, add one sentence: "The api runs in America/Santo_Domingo (`TZ` is set in `api/Dockerfile`), so months, days and bank-mail times are local; tests run in the same zone."

- [ ] **Step 2: Suites, build, commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add README.md
git commit -F- <<'EOF'
docs(readme): the api runs in the user's time zone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format=%B -5 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```
Expected: `5`, and a clean tree.

---

## After the tasks (controller)

1. Review, the private-identifier gate, and the push.
2. Hand the user:
   - restart `accounting-api` once CI is green;
   - verify the zone in the pod: `kubectl -n accounting-bot exec deploy/accounting-api -- node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(2026,0,1).toISOString())"` should print `America/Santo_Domingo 2026-01-01T04:00:00.000Z`;
   - check the log line "Mail-time correction: moved N …".
