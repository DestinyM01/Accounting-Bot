# Recurring Scheduler in the API — Design Spec (migration sub-project 2)

**Goal:** The api books recurring rules itself — hourly, with catch-up for occurrences missed while the scheduler was down — so the Telegram bot can be scaled to zero without silently stopping recurring bookings.

**Context:** The recurring cron lives in the bot (`repo/src/service/recurring.service.ts`): daily at 08:00 America/Santo_Domingo, it books only rules whose `dayOfMonth` equals today, and never catches up. The bot pod died on 2026-09-17 at 16:42 UTC (a node restart; its init container re-pulls `curlimages/curl:latest` from Docker Hub on every start, and that pull kept failing). Nobody noticed for a week because Telegram is no longer used, and every rule due Sep 18–24 was never booked.

The recurring cron is the only thing the bot still does that the web depends on. Its other crons are Telegram-only (15:47 inactivity reminder, 20:00 budget alert, 1st-of-month summary) or write admin counters nothing reads (23:59 analytics). Its "deduct premium" cron only flips `isPremium`; it moves no money.

**Migration order (revised 2026-09-24):** **this** → balance set + history page → categories page → cash envelopes → settings. Moved ahead of the balance page because the outage above is a silent money error that recurs every time the bot dies.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Where | api — new `RecurringSchedulerService` | The web depends on the api, so a dead scheduler now means a dead web, which gets noticed within minutes instead of a week. |
| Trigger | **One hourly sweep.** No fixed 08:00 run, no startup hook | On-time booking and catch-up are the same code path and run every day. Catch-up logic that only runs after outages is catch-up logic that is broken when it is finally needed. Latency: at most one hour after the due moment or after a restart. |
| Look-back | **31 days** | Covers an outage across a month end (due on the 28th, back on the 2nd). Anything older is skipped with a warning and never booked, so a long outage cannot move the balance by months of payments in one run. |
| "Handled" marker | New rule field `lastPeriod` (`'YYYY-MM'`), forward-only | Row existence cannot be the marker: soft-delete `$unset`s `recurringId`, so a deleted recurring row would be re-booked every hour. |
| Creation bound | The rule's **ObjectId timestamp** | `createdAt` has `default: Date.now`, so a legacy rule stored without it loads as "now" and would never catch up. `_id` carries the true creation time for every rule. |
| Row timestamp | The **due moment**: `dayOfMonth` at 08:00 Santo Domingo = 12:00 UTC | A late booking counts on its own day, month and budget. 12:00 UTC is mid-day in both UTC and UTC−4, so `periodKey()` returns the same month whatever time zone the process runs in. The Dominican Republic observes no DST. |
| Bot | Delete its recurring cron; `replicas: 0` | A bot restarted by mistake cannot book. Mongo keeps running: it is defined in the same Argo app (`repo/k8s`) — **that app must never be deleted**. |
| `source` | `'recurring'` | Distinguishes scheduler rows from `manual` and `email` everywhere. The bot never set `source`; its legacy rows keep it absent. |
| Owner | `BOSS_USER_ID` rules only | Every api path is scoped to the single user. Family accounts retired with the bot. |

---

## Due occurrences — a pure function

`api/src/recurring/due-occurrences.ts` — no Nest or Mongoose imports, in the style of `ingestion/reconciliation.service.ts`, so every case is a plain unit test.

```ts
export const LOOKBACK_DAYS = 31;
/** 08:00 America/Santo_Domingo (UTC−4, no DST). */
export const DUE_HOUR_UTC = 12;

export interface SchedulableRule {
  dayOfMonth: number;        // 1..28 (schema bound), so it exists in every month
  createdAt: Date;           // from the rule's ObjectId, NOT the createdAt field
  lastPeriod?: string;       // 'YYYY-MM'
  lastExecutedAt?: Date;
}

export interface Occurrence { period: string; dueAt: Date }

export function planOccurrences(
  rule: SchedulableRule,
  now: Date,
): { due: Occurrence[]; tooOld: Occurrence[] };
```

**Handled through** `H` = `rule.lastPeriod`, else `periodKey(rule.lastExecutedAt)`, else none. The fallback is correct for legacy rules because the bot always ran on the due day at 08:00 local (12:00 UTC), so `lastExecutedAt`'s month is the month of the occurrence it handled.

**Candidates:** one per month, from the month after `H` (or the month of `createdAt` when there is no `H`) through the current month. `dueAt = Date.UTC(y, m, dayOfMonth, DUE_HOUR_UTC)`, `period = periodKey(dueAt)`.

Each candidate is exactly one of:

| Condition | Outcome |
|---|---|
| `dueAt > now` | not yet due — ignored |
| `dueAt < createdAt` | before the rule existed — ignored |
| `now − LOOKBACK_DAYS ≤ dueAt ≤ now` | **due** |
| `dueAt < now − LOOKBACK_DAYS` | **tooOld** |

Both lists are ordered oldest first. `due` holds at most two entries per rule.

---

## Booking — `RecurringSchedulerService`

`api/src/recurring/recurring-scheduler.service.ts`. Imports `LedgerModule`; uses the `Recurring` and `Transaction` models.

`@Cron('5 * * * *')` → `sweep()`. A `running` flag, as in ingestion, makes an overlapping run return immediately.

`sweep(now = new Date())`, for each active rule of `BOSS_USER_ID`, each rule in its own try/catch so one failure never stops the rest:

1. `planOccurrences({ dayOfMonth, createdAt: rule._id.getTimestamp(), lastPeriod, lastExecutedAt }, now)`.
2. **tooOld** — mark handled at the newest skipped period (step 6) and log one warning per rule naming the skipped periods. Final: never re-logged, never booked.
3. **due**, oldest first — for each occurrence:
   - **Already linked?** `findOne({ userId, recurringId, recurringPeriod: period, ...NOT_DELETED })`. Found (the bank email arrived first) → mark handled. Outcome `satisfied`; no money.
   - **Insert** `{ userId, userName: rule.userName, transactionName: rule.transactionName, transactionType: rule.transactionType, amount: signed, timestamp: dueAt, category: rule.category, source: 'recurring', recurringId, recurringPeriod }`.
     - `signed` = `−|rule.amount|` for `TransactionType.EXPENSE`, `+|rule.amount|` for `TransactionType.INCOME`, taken through the enum — its values are the legacy Russian strings. Any other type fails closed: logged, counted `failed`, not marked.
     - Duplicate key `11000` on the `(userId, recurringId, recurringPeriod)` index → someone else booked it (an email, or a second api pod during a rollout) → mark handled. Outcome `satisfied`; no money.
   - **Move the balance:** `ledger.apply(signed, 'recurring', rule.transactionName, id)`. If it throws → `deleteOne({ _id: id })` (the permitted rollback of a row created milliseconds earlier with no `sourceMessageId`), outcome `failed`, **not** marked — the next hour retries.
   - **Mark handled** (step 6). Outcome `booked`.
   - **Stop at the first failure.** If an occurrence ends `failed`, the rule's later occurrences are not attempted this run. `lastPeriod` only moves forward, so booking a newer month would carry the marker past the failed one and it would never be retried.
4. The rule's category is not re-validated at booking time. It was validated when the rule was created, and a custom category deactivated since then must not stop a payment from being recorded.
5. Summary, one line per run: `Recurring sweep: booked N, satisfied M, skipped K (older than 31 days), failed F`.
6. **Mark handled** is a guarded, forward-only update:
   ```ts
   updateOne(
     { _id: rule._id, $or: [{ lastPeriod: { $exists: false } }, { lastPeriod: { $lt: period } }] },
     { $set: { lastPeriod: period, lastExecutedAt: now } },
   )
   ```
   `'YYYY-MM'` strings sort chronologically, so `$lt` is a correct month comparison. `lastExecutedAt` keeps driving the Recurring page's "last run".

### Concurrency

| Race | Result |
|---|---|
| Two api pods during a rollout | Both insert; the unique index admits one. The loser takes the `11000` path. The balance moves once. |
| The bot still running when the new api starts | Same as above: the bot's own `11000` path skips. The balance moves once. |
| Email arrives after the booking | Ingestion's existing "confirm in place" path attaches the mail to the booked row. No second row, no second balance change. Unchanged. |
| Email and sweep insert at the same moment | See "Known interaction" below. |

### Known interaction — recorded, not changed

If ingestion's insert loses the race on the recurring index, `ingestion.service.ts` treats every `11000` as a message-id duplicate and returns `'duplicate'` for that mail. Nothing is lost: ingestion re-reads the mailbox from the fixed `INGEST_START_AT` on every poll and de-duplicates by `sourceMessageId`, so on the next poll it finds the booked row and confirms it in place. The balance moves once either way.

**Constraint on the "advancing ingestion watermark" follow-up:** this self-repair depends on the mailbox start point staying fixed. An advancing watermark must first distinguish the two indexes' `11000`s.

---

## Schema

Add to **both** `api/src/shared/schemas/recurring.schema.ts` and `repo/src/mongodb/schemas/recurring.schemas.ts`:

```ts
/** Last occurrence handled — booked, found already satisfied, or skipped as too old — as 'YYYY-MM'. Only moves forward. */
@Prop() lastPeriod?: string;
```

Same collection; a field in one schema and not the other is a bug. No index is needed: the sweep reads every active rule of one user.

---

## Bot (`repo/`)

- Remove `processRecurring` and the helpers only it used (`currentPeriodKey`, `isSameMonth`, and `TransactionService.findOneByRecurringPeriod` if nothing else calls it), with their tests. Keep `createRecurring` / `listRecurring` / `deleteRecurring`; they are unreachable at zero replicas and not this sub-project's concern.
- `repo/k8s/deployment.yaml`: `replicas: 0`, with a comment saying the bot is retired, recurring moved to the api, and Mongo lives in this same Argo app, so the app must never be deleted.
- Nothing else in `repo/` changes.

---

## Rollout

One push.

1. Argo applies `replicas: 0` (a manifest change) and removes the bot pod — including the one stuck on the Docker Hub pull.
2. The api is a code-only change, so the user runs `kubectl -n accounting-bot rollout restart deployment/accounting-api`.
3. Nothing books between steps 1 and 2. That is harmless: the first sweep after the restart catches up.
4. Verify: `kubectl -n accounting-bot logs deploy/accounting-api --since=2h | grep "Recurring sweep"`. The first run books every rule due Sep 18 through deploy day, each dated on its own day and linked, and the Recurring page's "last run" updates.

---

## Testing

Written first; each must fail before its implementation exists.

**`planOccurrences`** — unless a case says otherwise, the rule was created 2026-01-01.
- **The incident:** a legacy rule (`dayOfMonth` 20, no `lastPeriod`, `lastExecutedAt` Aug 20 12:00 UTC), `now` = Sep 25 → `due` = one occurrence, period `2026-09`, `dueAt` = Sep 20 12:00 UTC; `tooOld` empty.
- On time: `dayOfMonth` 25, `now` = Sep 25 12:30 UTC, handled through `2026-08` → due `2026-09`. At 11:30 UTC the same day → nothing yet.
- Across a month end: `dayOfMonth` 28, handled through `2026-08`, `now` = Oct 2 → due `2026-09` only (October's is not yet due).
- Too old: handled through `2026-06`, `dayOfMonth` 10, `now` = Sep 25 → `2026-07` and `2026-08` in `tooOld` (Aug 10 is 46 days back), `2026-09` due.
- Created after the due moment: `_id` time Sep 24 15:00 UTC, `dayOfMonth` 24, `now` = Sep 25 → nothing; the first occurrence is `2026-10`.
- Already handled: `lastPeriod` `2026-09`, `now` = Sep 25 → nothing.
- `lastPeriod` wins over `lastExecutedAt` when both are present and disagree.
- No `lastPeriod` and no `lastExecutedAt`: bounded by creation month and the window.

**`RecurringSchedulerService`** (models and ledger mocked)
- Books: one insert with `source: 'recurring'`, the link, `timestamp: dueAt`; `ledger.apply` called once with the signed amount and `'recurring'`; the marker set to the period.
- Sign through the enum: an expense rule stored with a positive amount books negative; an income rule books positive; an unknown `transactionType` books nothing and counts `failed`.
- Already linked → no insert, no ledger call, marker set.
- `11000` on insert → no ledger call, marker set.
- Ledger throws → the row deleted by id, marker **not** set, outcome `failed`.
- Two due occurrences, the older fails → the newer is not attempted and the marker stays before the failed month.
- One rule throwing does not stop the next rule from booking.
- `tooOld` → marker moved to the newest skipped period, no insert, one warning.
- Mark-handled filter is forward-only: the update filter carries `lastPeriod: { $lt: period }` / `$exists: false`.
- `running` guard: a second `sweep()` while one is in flight returns without touching the models.
- Scope: rules are queried with `userId: BOSS_USER_ID, active: true`.

**Bot**
- `repo` suite green after removing the cron; no remaining reference to `processRecurring` or `findOneByRecurringPeriod` (`git grep` in the plan's verification step).
- `repo/k8s/deployment.yaml` has `replicas: 0`.

**Regression**
- `api` and `repo` suites green; `web` untouched.

---

## Out of scope

- The bot's Telegram notifications (inactivity reminder, budget alert, monthly summary) — they retire with the bot.
- The Docker Hub init-container fragility — moot at zero replicas.
- An advancing ingestion watermark — still a follow-up, now with the constraint above.
- Balance set + history page — the next sub-project.
- A web indicator for late bookings — the summary log line and the Recurring page's "last run" are enough; the scheduler failing now takes the web down with it.

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:** one marker (`lastPeriod`, forward-only) decides "handled" everywhere — booked, satisfied and skipped all set it; nothing else does. Because it only moves forward, occurrences are handled strictly oldest first and a rule stops at its first failure; nothing can advance the marker past an unhandled month. Row existence is consulted only to avoid a second row, never to decide "handled". The balance moves only after a successful insert and at most once per `(rule, period)`, which is what the unique index enforces for every writer.

**Ambiguity resolved:** "31 days" is measured from `now` to `dueAt`, both instants; "due" includes `dueAt == now`; a rule created at or before its due moment books it; the marker after a skip is the newest skipped period, not the current one.

**Scope:** one goal — the api owns recurring bookings. The bot changes are a deletion and one manifest line.
