# Code-Review Fixes (Round B) — Design Spec

**Goal:** Fix the application findings of the 2026-09-26 project code review on the current stack, before the Node 24 and MongoDB upgrades. This is round B of `2026-09-26-upgrade-roadmap.md`, covering findings 2, 4, 5, 6 (clean shutdown), and 8–14.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Owner check | The token's `sub` must equal `OWNER_SUB` (a Secret key). While unset, the api **refuses everyone** and logs the rejected id so the owner can set it. |
| Bank-mail verification | Gmail's own `Authentication-Results` must show DMARC or DKIM passing for the sender's domain. Rollout is **report first** (`MAIL_VERIFY=report`), then `MAIL_VERIFY=enforce`. |
| Ingestion window | A stored **resume point**, not a fixed start date and not IMAP UIDs. |

## Part 1 — api security and mail

### 1. Only the owner (finding 2) — `api/src/auth/jwt.strategy.ts`

**`validate(payload)`:**
- `OWNER_SUB` is read from env and trimmed.
- **When it's unset:**
  - log a warning: `No OWNER_SUB configured: refusing everyone. The owner's id is shown here after their first login: set OWNER_SUB to "<payload.sub>" in the api's Secret and restart.`;
  - throw `ForbiddenException("AccBot isn't set up for an owner yet — see the api log.")`.
- **When `payload.sub !== OWNER_SUB`:**
  - log a warning naming the rejected `sub`;
  - throw `ForbiddenException("This account can't use AccBot.")`.
- **Otherwise** return the payload.

**Audience:** when `AUTHENTIK_CLIENT_ID` is set, the passport-jwt options add `audience: AUTHENTIK_CLIENT_ID`.

**`api/k8s/deployment.yaml`:**
- add `OWNER_SUB` from `accounting-bot-secret`, `optional: true`;
- add `AUTHENTIK_CLIENT_ID` as a plain value. It is the web's public client id, already in `web/src/app/core/auth/auth.config.ts`.

### 2. Verified bank mail (finding 4)

**New pure function**, `api/src/ingestion/mail-auth.ts`: `verifySender(authResults: string | undefined, fromAddress: string): boolean`.
- Only the **topmost** `Authentication-Results` header is considered, and only when its authserv-id is `mx.google.com`. Gmail prepends its own header, so a forged one lower in the mail is ignored.
- `fromDomain` is the part of the From address after `@`, lowercased.
- A domain **aligns** with `fromDomain` when it equals it, or when either one is a subdomain of the other.
- It returns **true** when one of these holds:
  - `dmarc=pass` with a `header.from` domain that aligns;
  - `dkim=pass` with a `header.d` domain, or a `header.i` domain after the `@`, that aligns.
- It returns **false** otherwise, including when the header is missing.

**`MailClient`:**
- takes the first `authentication-results` entry of mailparser's `headerLines`, which is the topmost header;
- `verifySender` strips the `Authentication-Results:` name and unfolds the continuation lines;
- sets `FetchedMail.verified`.

**`IngestionService`:**
- **Mode.** It reads `MAIL_VERIFY`: `'report'` is the default, and `'enforce'` is the other value.
- **Counting.** Every fetched mail that isn't verified, already booked or not, adds to a new run count, `unverified`, and logs a warning naming its sender and message id. That count sits outside the five buckets, which still add up to all mails.
- **Report mode:** the mail is processed as usual.
- **Enforce mode:** a new mail (not already booked and not dismissed) that isn't verified is recorded as unreadable with the reason `Couldn't verify it came from the bank` instead of being parsed, and counted in `unreadable`.

**Storage and display:**
- `UnreadableMail` gains an optional `reason`. The Settings unreadable list shows it when present.
- `IngestionStatus` stores `unverified`.
- The Settings "Last checked" line appends "N unverified" when it's above zero.

**Deployment:** `MAIL_VERIFY: report` as a plain value in `api/k8s/deployment.yaml`. The owner flips it to `enforce` once all four banks show as verified.

### 3. Safe mail parsing (finding 5)

**`api/src/ingestion/html-to-text.ts`:** `decodeEntities` returns `�` for a numeric entity that isn't a valid code point, meaning n < 0, n > 0x10FFFF, or a surrogate (0xD800–0xDFFF), instead of calling `String.fromCodePoint`.

**`MailClient.fetchSince`:** parsing each message (`simpleParser`, sender and date, `htmlToText`) sits inside its own try/catch. A failure logs `Skipped an unparseable mail (uid N): <error>` and moves on to the next message.

### 4. Clean shutdown (finding 6)

- **`api/src/main.ts`:** `app.enableShutdownHooks()`.
- **The three schedulers.** `IngestionService`, `RecurringSchedulerService` and `ReportSchedulerService` each implement `BeforeApplicationShutdown`:
  - it sets a `stopping` flag first, so no new run starts once shutdown has begun (a run that would start returns as skipped);
  - then, while `running` is true, it polls every 100 ms for up to 25 s, and returns;
  - a wait that times out logs a warning.

  The database connection closes only after these hooks return, in `onApplicationShutdown`.
- **`api/k8s/deployment.yaml`:** `terminationGracePeriodSeconds: 45`.

### 5. Resume point (finding 8)

- **Storage.** `IngestionStatus.resumeFrom?: Date`.
- **Where a check starts.** `IngestionService.watermark()` becomes async. It returns `max(configuredStart, stored resumeFrom)` when both exist, else whichever exists, else `now − 24h`. `configuredStart` is `parseConfiguredInstant(INGEST_START_AT)`.
- **Computing the resume point after a run:**
  - `runStart` is when the run began, before the fetch. Every mail delivered before then has been seen.
  - `pendingOldest` is the earliest `receivedAt` among this run's booking failures and the non-dismissed unreadable records, read after this run's updates.
  - `resumeFrom = min(runStart, pendingOldest ?? runStart) − 2 days`. The 2 days cover late delivery and clock skew.
  - It is stored with the run's counts.
  - A run that fails as a whole doesn't move it, so after an outage the next run starts from the last good run.
- **Why the run's start time and not the newest mail's:**
  - A quiet inbox then doesn't make the window grow.
  - An empty run doesn't slide the point back another 2 days each time.
  - In steady state the window is about 2 days plus the poll interval.
- **The window can stay open.** An unreadable mail that isn't dismissed keeps the window open back to it until it books or you dismiss it on Settings. That's what lets a parser fix pick it up later. Today, with a configured start date, every poll re-reads everything since that date anyway.
- **Forgetting old unreadable records.** `forgetUnreadableBefore` is called with the **configured start** only, and only when one is set. It never uses the moving window.
- **The comment** above the dedupe in `run()`, which says the watermark never advances, is updated.

## Part 2 — web and data fixes

### 6. The Dashboard keeps refreshing (finding 9) — `web/src/app/pages/dashboard/dashboard.component.ts`

- The `forkJoin` inside `switchMap` gets `catchError`. On an error, the page keeps its last data and sets `refreshError = true`. It clears the flag on the next success.
- The template shows a muted "Couldn't refresh — retrying" while the flag is set.
- The timer and `changed$` streams stay alive.

### 7. Search on the server (finding 10)

**Api:**
- `TransactionQuery` and `ExportQuery` gain `search?: string`, capped at 100 characters.
- When the trimmed term isn't empty, `buildFilter` sets `filter.$or = [{ transactionName: rx }, { merchant: rx }]` with `rx = new RegExp(escapeRegExp(term), 'i')`.
  - The cursor already wraps the whole filter in `$and`, so its own `$or` doesn't collide.
  - The total count honours the term too.
- `escapeRegExp` moves from `api/src/ingestion/parsers/own-party.ts` to `api/src/shared/escape-regexp.ts`, which both files import.
- The controllers read `@Query('search')` for both the list and the export, and pass it through.

**Web:**
- `getTransactions` and `exportTransactions` send `search`.
- The Transactions page includes the search term in `currentFilters()`, and its list no longer filters locally by the search text. The debounced search input reloads from the top.

### 8. Budgets are checked (finding 11) — `api/src/budget/budget.service.ts`

**`set()` returns 400 when:**
- `limitAmount` isn't a finite number, is ≤ 0, or is above 1e9;
- `month` is given but isn't an integer from 1 to 12;
- `year` is given but isn't an integer from 2000 to 2100.

**Saving:**
- The write is an upsert. A duplicate-key error (code 11000) retries once as a plain `findOneAndUpdate` without upsert.
- `BudgetSchema.index({ userId: 1, category: 1, month: 1, year: 1 }, { unique: true })`.
- `BudgetService.onModuleInit` logs an error when the index can't be built, following `CategoriesService`.
- `get()` returns `percentage: 0` when `limitAmount <= 0`, for legacy rows.

### 9. Safe CSV cells (finding 12) — `api/src/transactions/transactions.service.ts`

A helper `csvText(value)` quotes and escapes as today. It also prefixes `'` when the value starts with `=`, `+`, `-`, `@`, `\t` or `\r`. It applies to the name and category columns, since categories can be custom names. The other columns are dates, fixed words and amounts, and stay as they are.

### 10. Statistics chart cleanup (finding 13)

`StatisticsComponent` implements `ngOnDestroy`, which destroys `areaChart` and `savingsChart`.

### 11. Ordinals (finding 14)

`web/src/app/pages/recurring/recurring.component.ts`'s `scheduleLabel` uses an `ordinal(n)` helper: 11–13 take "th"; otherwise 1 "st", 2 "nd", 3 "rd", and the rest "th", judged by the last digit.

## Testing

- **Api:**
  - **Owner check:** the owner passes; another `sub` gets 403 and a warning; an unset `OWNER_SUB` gets 403 and a log naming the `sub`; the audience option appears only when configured.
  - **`verifySender`:**
    - passes on `dmarc=pass` aligned, on `dkim=pass` aligned through `header.d` and through `header.i`, and on an aligned subdomain;
    - fails on no header, on a non-Google topmost header, on a forged Google-looking header below a failing top one, on `dkim=fail`, and on a misaligned domain.
  - **Ingestion:** report mode books and counts `unverified`; enforce mode records the unreadable reason; the status stores `unverified`.
  - **Parsing:** `decodeEntities` at 0x10FFFF, 0x110000, 99999999 and a surrogate; `fetchSince` skipping one throwing message and returning the others (a mocked imapflow/simpleParser boundary).
  - **Shutdown:** `beforeApplicationShutdown` waits while `running`, returns once it clears, times out with a warning, and stops a new run from starting.
  - **Watermark:**
    - first run;
    - `resumeFrom` stored as `runStart − 2 days`;
    - an empty run doesn't slide it back;
    - pending unreadable or failed mail pulls it earlier;
    - an outage with no configured start resumes from the stored point;
    - never earlier than the configured start;
    - a failed run doesn't move it;
    - `forgetUnreadableBefore` only with the configured start.
  - **Search:** the regex is escaped, combined with filters and the cursor, and honoured in the export.
  - **Budget:** each validation 400; the duplicate-key retry; the index declaration; the onModuleInit log.
  - **CSV:** every trigger character is prefixed; the amount column is untouched.
- **Web:** a clean build. Preview checks:
  - the Dashboard survives a failing call and recovers;
  - search finds a row beyond the first page;
  - Statistics cleans up (no leftover chart instances after leaving);
  - the ordinals.

## Deployment notes

- **Before or right after deploying:**
  1. Log in once.
  2. Read the id from the api log: `kubectl -n accounting-bot logs deployment/accounting-api | grep OWNER_SUB`.
  3. Add `OWNER_SUB` to `accounting-bot-secret`.
  4. Restart the api.

  Until then the web app shows load errors.
- **After a few days** of Settings showing no unverified mail from any of the four banks, set `MAIL_VERIFY` to `enforce` and restart.
