# Hardening (Group 2) — Design Spec

**Goal:** Close six follow-ups from earlier plans. Each one is a failure that is rare but silent, or a number that misleads:
- mail times that depend on `TZ`;
- cash usage and the cash counter;
- duplicate category names;
- an unbounded day of month on recurring rules;
- noisy mail-check counts;
- own-name fragments that match inside other people's names.

Each section stands alone and is its own task.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Santo Domingo time | **Fixed-offset helpers** in one module (UTC−4 all year; the Dominican Republic has no DST), used by the parsers and the existing hand-rolled copies. No `Intl` zone math, and no reliance on `TZ` for mail times. |
| Name fragments | **Whole words only**, case-insensitive and Unicode-aware. The user confirmed their fragments are whole words. |
| Cash counter left high | **Repaired when it's hit.** A refused itemize recounts the items, corrects the counter with a guarded write, and retries once. |
| Existing duplicate category names | No migration. If the index can't be built, the app keeps working as today, and the fix is to delete one duplicate and restart. |

## 1. Mail times don't depend on `TZ`

**New module `api/src/shared/santo-domingo.ts`:**
- `SANTO_DOMINGO_OFFSET_HOURS = 4`;
- `santoDomingoInstant(year, monthIndex, day, hour = 0, minute = 0, second = 0): Date`. It returns `new Date(Date.UTC(year, monthIndex, day, hour + 4, minute, second))`, the moment that Santo Domingo wall-clock time happens;
- `santoDomingoWallClock(d: Date): Date`. It shifts `d` back 4 hours, so its UTC getters read the Santo Domingo calendar. This is the existing idiom;
- `santoDomingoDateKey(d: Date): string`. It returns `'YYYY-MM-DD'` of `d` in Santo Domingo.

**Users:**
- **`api/src/ingestion/parsers/dates.ts`.** Every parser builds its result with `santoDomingoInstant` instead of `new Date(y, m, d, …)`:
  - `parseDdMmYyyy`
  - `parseDdMmYyyy12h`
  - `parseDdMmYyyyDash12h`
  - `parseDMyHms`
  - `parseSpanishLongDate`

  A date with no time becomes Santo Domingo midnight, which is 04:00 UTC.
- **`api/src/balance/daily-closings.ts` and `api/src/reports/report-render.ts`** drop their `LOCAL_OFFSET_MS` copies and use the module.
- **`api/src/recurring/due-occurrences.ts`** defines `DUE_HOUR_UTC = 8 + SANTO_DOMINGO_OFFSET_HOURS`.
- **`api/src/reports/report-periods.ts`** defines `DUE_HOUR_UTC = 7 + SANTO_DOMINGO_OFFSET_HOURS` and `LOCAL_MIDNIGHT_HOUR_UTC = SANTO_DOMINGO_OFFSET_HOURS`.

**Not changed:**
- `shared/time-zone.ts`, the server-zone helpers for days picked in the UI;
- the one-time mail-time backfill;
- `mailTimeLocal`.

The instants the code produces don't change, so every existing test passes untouched.

## 2. Cash

**Usage.** `CategoryReferencesService.usage()` counts only the cash items whose withdrawal is live. It reads the distinct `withdrawalId`s of the user's items, keeps those that name a transaction that is live (`NOT_DELETED`), and aggregates items with `withdrawalId: { $in: liveIds }`. `migrate()` is unchanged and still moves every item, so nothing keeps naming a dead category.

**Counter repair.** In `CashService.add`, when the guarded reservation misses:
1. Load the withdrawal as a live row that can be itemized, the same check `whyNotReserved` does. If it isn't one, throw that same error.
2. Sum its items and round to cents. If `allocatedCash` exceeds the sum by more than `HALF_CENT`:
   - run `updateOne({ _id, userId, allocatedCash: <value read> }, { $set: { allocatedCash: sum } })`;
   - log a warning naming the withdrawal and both figures;
   - if the write modified the row, try the reservation once more.
3. If the reservation still misses, or nothing needed repair, throw `whyNotReserved`'s error: "Only $X is left to itemize".

The repair runs at most once per request. **Known limit:** an itemize from another tab that has reserved but not yet inserted, in the same milliseconds, could be undercounted by its amount. That's accepted for a single user.

## 3. Unique active category names

- `CustomCategorySchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { active: true } })`. Deleted (inactive) records may share a name.
- `CategoriesService` turns a duplicate-key error (`code 11000`) from the three name writes (create, revive and rename claim) into the same `409` its `assertNameFree` check already gives. The message is the one that call would have given.
- **Deploy note:** if two active categories already share a name, Mongoose logs an index build error at startup and everything else works as before. The fix is to delete one on the Categories page and restart the api.

## 4. Recurring day of month

- `Recurring.dayOfMonth` is `@Prop({ required: true, min: 1, max: 28, validate: Number.isInteger })`.
- The scheduler checks each loaded rule. One whose `dayOfMonth` isn't a whole number from 1 to 28 (for example a legacy row) is skipped with a warning log, instead of being booked on a day that spills into the next month.

## 5. Mail-check counts

`IngestionService.run()` returns, and `IngestionStatusService` stores, five counts in place of `created`, `skipped` and `failed`:

| Count | Meaning |
|---|---|
| `created` | Booked this run |
| `alreadyBooked` | Its message id is already booked, or `persist` answered `duplicate` |
| `notTransactions` | Dismissed by the user, recognised as non-transactional (payroll or marketing), or with no parser |
| `unreadable` | The parser returned nothing. These are the mails recorded as `UnreadableMail` |
| `bookingFailed` | `persist` answered `failed`; the mail is retried on the next poll |

**Storage and the api:**
- `IngestionStatus` stores these five. The old `skipped` and `failed` fields are no longer written.
- The view's `lastRun` is `{ at, created, alreadyBooked, notTransactions, unreadable, bookingFailed }`; a missing field reads as 0.
- `POST /ingestion/run` answers the same five.
- The run's log line uses the same names.

**Web (`web/src/app/pages/settings/mail-section/`):**
- `RunCounts` is updated to the five counts.
- One formatter, `countsText(c)`, builds the text: "N new", then "N already booked", "N not transactions", "N couldn't read" and "N couldn't book", each shown only when greater than 0.
- The status line reads "Last checked {at} · {countsText}".
- "Check mail now" reports "Checked: {countsText}."

## 6. Whole-word own-name matching

`matchesOwn` in `api/src/ingestion/parsers/own-party.ts`:
- **Numeric identifiers** are unchanged (digit boundary).
- **Other fragments** match whole words:
  - the fragment is trimmed and lowercased;
  - regex special characters are escaped;
  - internal whitespace becomes `\s+`;
  - the result is wrapped in `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` and tested with the `iu` flags.
- **Examples:**
  - "rivera" matches "JUAN RIVERA MARTE" but not "RIVERAS";
  - "ana" no longer matches "MARIANA";
  - "juan antonio" matches "JUAN  ANTONIO RIVERA".

**Settings, Bank accounts section:**
- The heading becomes "How you appear as a sender (last 4 digits or a whole word of your name)".
- The muted line becomes "Used to recognise transfers you send. A name matches whole words only: "rivera" matches "JUAN RIVERA", not "RIVERAS"."

## Testing

- **`santo-domingo.ts`:**
  - `santoDomingoInstant(2026, 8, 18, 15, 11)` is `2026-09-18T19:11:00.000Z`;
  - midnight is 04:00Z;
  - `santoDomingoDateKey` at 03:59Z gives the previous day, and at 04:00Z the same day;
  - `santoDomingoWallClock` reads the local fields.
- **Parsers:** every parser date function gives the same instants with `process.env.TZ` set to `'UTC'` inside the test, restored afterwards. Existing parser, balance, report and recurring tests pass unchanged.
- **Cash:**
  - `usage()` leaves out items of deleted withdrawals, with the exact queries;
  - `migrate()` still moves every item;
  - repair:
    - a high counter: the guarded `$set` uses the value read, the reservation is retried once, and the add succeeds;
    - a correct counter: no write, and the normal 400;
    - the guard misses: no retry, and the normal 400;
    - a withdrawal that can't be itemized: its error, and no repair.
- **Categories:**
  - the schema declares the partial unique index;
  - a duplicate-key error on create, revive or rename gives the 409 with the matching message.
- **Recurring:**
  - `validateSync` rejects 0, 29 and 1.5, and accepts 1 and 28;
  - the scheduler skips an out-of-range rule, logs a warning and books the others.
- **Ingestion:** one run with a mail of each kind gives each count exactly, and the stored status and the view carry them.
- **`matchesOwn`:**
  - whole words;
  - accented letters ("núñez" doesn't match inside "NÚÑEZA");
  - a multi-word fragment with extra spaces;
  - regex special characters taken literally ("a.b" doesn't match "AXB");
  - the digit rule unchanged;
  - the existing parser suites still pass.
- **Web:** a clean build.

## Settled in review (2026-09-25)

- **The time-zone test** runs the parsers in a child process with another `TZ`, because Jest sandboxes `process.env`.
- **Index build failures are logged.** `CategoriesService.onModuleInit` logs a failed build of the unique index, which Mongoose would otherwise swallow.
- **Identifier shapes in `matchesOwn`:**
  - all digits match on a digit boundary;
  - digits mixed with letters (a masked account) match as a substring;
  - letters only match whole words, after NFC normalisation, with combining marks treated as part of a word.
- **Mail-check text** says "1 not a transaction" in the singular.
