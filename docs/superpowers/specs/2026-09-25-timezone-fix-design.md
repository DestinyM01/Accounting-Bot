# Time Zone Fix — Design Spec

**Goal:** The api works in the user's time zone, America/Santo_Domingo (UTC−4 all year, no DST), instead of UTC. Months, days and bank-mail times are then the user's own.

**The problem:**
- **Month edges.** The api container runs in UTC. From 8 pm local time on a month's last day, every server-local month (Statistics, budgets, the monthly email, Compare, Tips, the growth calculator) has already rolled over.
- **Bank-mail times.** They are read with local-time `Date` constructors, so they have been stored as if they were UTC: "09:53 pm" became 21:53Z, which the web shows as 5:53 PM. Date-only mails landed on the previous evening.
- **What is already correct.** The code that does UTC−4 arithmetic by hand, with UTC getters, is unaffected: the report periods and rendering, the recurring due times, and the balance chart's day buckets.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Where the zone is set | **`ENV TZ=America/Santo_Domingo` in the api Dockerfile**, plus `tzdata` | The zone takes effect exactly when the new code starts. A manifest `TZ` could let Argo restart the old image with the new zone first, which would make the one-time correction's cut-off wrong. |
| Old mail rows | **Corrected once, automatically**, on the api's first start in the right zone | The user's choice ("correct them once"); running it in the api gives an exact cut-off and nothing to run by hand. |
| Tests | **Always run in America/Santo_Domingo** (Jest global setup) | Deterministic on every machine, and the same as production. |

## Changes

1. **The Transactions date filter.** `startDate`/`endDate` (`YYYY-MM-DD`) are calendar days in the user's zone:
   - start is 00:00:00.000 local;
   - end is 23:59:59.999 local.

   `new Date('YYYY-MM-DD')` reads the string as UTC midnight; under the new zone that would drop the whole end day. A malformed date is a 400.
2. **Compare's month list** groups with `$year`/`$month` in the server's zone (`timezone` passed explicitly), matching the local month boundaries it then queries.
3. **Mail rows carry `mailTimeLocal: true`.** `Transaction` gains `mailTimeLocal?: boolean`: "this row's time was read in the user's zone". The ingester sets it on every row it creates, and on a recurring prediction it confirms in place.
4. **The one-time correction** (`MailTimeBackfillService`, run on application bootstrap, in the background, never blocking or failing the start):
   - **Only in the right zone.** If the server's zone isn't America/Santo_Domingo, it logs and does nothing.
   - **A marker fixes the cut-off.** A `Migration` document `{ name: 'mail-times-to-santo-domingo', cutoff, doneAt?, shifted? }` has a unique `name`. The first start upserts it with `cutoff` = that start; a retry reuses the stored cut-off; a finished marker means nothing to do.
   - **One write shifts the rows:** `updateMany` on the raw collection. It matches `sourceMessageId` exists, `_id` created before the cut-off, and `mailTimeLocal ≠ true`. It adds 4 hours to `timestamp` and sets `mailTimeLocal: true` in the same pipeline.
   - **It can't shift a row twice.** Because every shifted row is marked, a crash mid-way, a retry, or two pods starting at once never shifts a row twice.
   - **A duplicate-key race** on the marker upsert re-reads the marker.
   - **Once done,** it records `doneAt` and the count, and logs the count.
   - **Balances are untouched:** only `timestamp` moves.
5. **The Dockerfile's runtime stage:** `RUN apk add --no-cache tzdata` and `ENV TZ=America/Santo_Domingo`.

## Testing

- **The test zone:** a spec pins the zone (`new Date(2026, 0, 1)` is `2026-01-01T04:00:00.000Z`, and `Intl` reports America/Santo_Domingo).
- **Parsers:** a BHD time `24/09/2026 09:53 pm` is stored as `2026-09-25T01:53:00.000Z`.
- **Transactions filter:**
  - `2026-09-01`…`2026-09-30` gives `$gte 2026-09-01T04:00:00.000Z` and `$lte 2026-10-01T03:59:59.999Z`;
  - a malformed date is a 400.
- **Compare:** the `$group` uses `timezone: 'America/Santo_Domingo'`.
- **The ingester:** a created row, and a confirmed prediction, carry `mailTimeLocal: true`.
- **The correction:**
  - wrong zone gives no writes;
  - the first run upserts the marker with the start as its cut-off and shifts with the exact filter and pipeline;
  - a finished marker gives nothing;
  - an unfinished marker reuses its cut-off;
  - a duplicate key re-reads the marker;
  - the bootstrap hook never throws.

## Out of scope

- **Transactions booked during the rolling restart.** A mail booked by the old UTC pod after the new pod started stays 4 hours early. The window is seconds; polls run every 10 minutes.
- **The bot's data.** It never read bank mail, and its times are true instants.
- **Other time zones or DST:** a single user, in a zone without DST.
