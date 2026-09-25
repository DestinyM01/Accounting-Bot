# Settings Page — Design Spec (migration sub-project 7)

**Goal:** A Settings page on the web that:
- shows how bank-mail ingestion is doing, and lets you act on it;
- controls the emailed reports;
- edits the user's own-account identifiers.

All three are driven today by environment variables and visible only in pod logs.

**Context:**
- **The bot's Settings menu** had language, currency, family sharing, reset-all, premium, admin analytics and set-balance.
  - Set-balance shipped with the Balance page.
  - Family, premium and admin were for a multi-user Telegram bot and are dropped.
  - Language, currency display and reset-all were not chosen.
- **The new world's pain points:**
  - An unreadable bank mail showed up only as a log line; the BHD alerts were "Unusable" for days unnoticed.
  - Report on/off and recipient need a k8s Secret edit.
  - The own-account lists (`OWN_CASH_ACCOUNTS`, `OWN_ACCOUNT_IDENTIFIERS`) live in the Secret, because the repository is public.
- **The web today** has a gear dropdown in the top bar (name, Authentik profile link, log out) and no Settings page.

**Migration order:** recurring scheduler → email reports → balance page → categories page → cash envelopes (all done) → **this** → compound-interest calculator.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Mail ingestion status, email report controls, bank accounts** | The user's choice. Money display, language and reset-all were not chosen. |
| Where settings live | **One `Settings` document in MongoDB**, one section per area | Single-user app; typed validation; each section saves atomically. The database isn't public, so account digits and name fragments may live there. |
| Environment variables | **Starting values only.** A saved field wins; a field never saved falls back to today's variable | Nothing changes for the user until they save, and the Secret can be trimmed afterwards. |
| Operational data | **Separate collections:** an ingestion status document and `UnreadableMail` records | These are records of what happened, not settings. |
| Unreadable mails | **See, retry ("Check mail now") and dismiss ("Not a transaction")** | The user's choice. A dismissed mail is skipped before parsing, so it stops being retried and logged. |
| Account changes | **Apply from the next check; never rewrite booked transactions** | Reclassifying history would move the balance behind the user's back. |
| A turned-off report | **Recorded as `skipped` when it falls due** | Turning it back on never sends an old report (the same rule as the existing expiry window). |
| Send test digest | **Moves from the Dashboard to Settings** | It belongs with the report controls. |

---

## Data

### `Settings` (`api/src/shared/schemas/settings.schema.ts`)

One document per user (unique index on `userId`). Every field is optional; absent means "use the environment".

```ts
reports?: { weekly?: boolean; monthly?: boolean; recipient?: string | null };
accounts?: { cash?: string[]; senders?: string[] };
```

### `IngestionStatus` (`api/src/shared/schemas/ingestion-status.schema.ts`)

One document per user (unique `userId`):

| Field | Meaning |
|---|---|
| `lastRunAt` | when the last run finished |
| `created`, `skipped`, `failed` | that run's counts |
| `lastError`, `lastErrorAt` | the last run that failed as a whole (for example, IMAP login refused). A successful run sets `lastError` back to `null`. |

### `UnreadableMail` (`api/src/shared/schemas/unreadable-mail.schema.ts`)

Unique index on `{ userId, messageId }`:

| Field | Meaning |
|---|---|
| `messageId`, `sender`, `subject`, `receivedAt` | from the mail |
| `firstSeenAt`, `lastSeenAt`, `attempts` | when and how often it failed |
| `dismissed` | `false` until "Not a transaction" |

---

## API

All routes use the class-level `JwtAuthGuard`, pinned in the existing guard table.

### `SettingsService` (`api/src/settings/`)

The one reader of the store, with its fallbacks:

| Resolved value | Saved field | Fallback |
|---|---|---|
| `reports.weekly`, `reports.monthly` | `reports.weekly`, `reports.monthly` | `true` |
| `reports.recipient` | `reports.recipient` (non-empty) | `REPORT_TO`, else `GMAIL_USER`, else `null` |
| `accounts.cash` | `accounts.cash` | `OWN_CASH_ACCOUNTS`, comma-split, trimmed, empties dropped |
| `accounts.senders` | `accounts.senders` | `OWN_ACCOUNT_IDENTIFIERS`, the same way |

Every resolved value carries its `source`: `'saved'` or `'config'`.

**`GET /settings`** returns the resolved sections. `reports` adds `lastSent: { weekly, monthly }`: the latest `ReportSend` with `status: 'sent'` of each kind, as `{ period, at }` or `null`.

**`PUT /settings/reports`**, body `{ weekly: boolean, monthly: boolean, recipient: string | null }`:
- Booleans are required.
- `recipient`:
  - trimmed;
  - empty or `null` clears the saved value, falling back;
  - otherwise it must match a simple address pattern and be ≤ 254 characters.
- Written in one `$set` of `reports` with upsert.

**`PUT /settings/accounts`**, body `{ cash: string[], senders: string[] }`:
- `cash`: each exactly 4 digits, no duplicates, at most 20.
- `senders`: each trimmed, 3–40 characters (one letter would match everyone), unique ignoring case, at most 20.
- An empty list is allowed; the page warns before saving an empty `cash`.
- Written in one `$set` of `accounts` with upsert.

Both return the new `GET /settings` body. Every failure is a 400 with a message.

### Ingestion (`api/src/ingestion/`)

- **Account lists come from `SettingsService`.** `run()` reads `accounts.cash` and `accounts.senders` from it instead of `process.env`, once per run.
- **Dismissed mails are skipped first.** Before parsing, `run()` loads the dismissed message ids among the fetched mails and skips them (counted as `skipped`).
- **Unreadable mails are recorded.** When a mail is "Unusable", or its parser throws, it is upserted into `UnreadableMail`: `$set` sender, subject, `receivedAt` and `lastSeenAt`; `$setOnInsert` `firstSeenAt` and `dismissed: false`; `$inc attempts`. The existing warning log stays.
- **A readable mail leaves the list, on every path.** It is deleted when:
  - the mail's `persist` returns `created` or `duplicate`;
  - a parser recognises it as not a transaction;
  - at the start of each run, it is already booked (in case an earlier clear failed).
- **The status is recorded.**
  - At the end of every run: `lastRunAt`, the counts, and `lastError: null`.
  - When the whole run fails (the existing `poll()` catch): `lastError` (the message, ≤ 500 characters) and `lastErrorAt`.
  - Status writes are best effort: a failure is logged and never fails the run.
- **`poll()` becomes `runGuarded()`.** It returns the run's counts, or `null` if a run is in flight. The cron calls it and `POST /ingestion/run` calls it.

**`GET /ingestion/status`**:
```ts
{
  startAt: string | null;          // INGEST_START_AT, read-only
  running: boolean;                // this pod has a run in flight
  lastRun: { at, created, skipped, failed } | null;
  lastError: { at, message } | null;
  unreadable: { id, sender, subject, receivedAt, attempts, lastSeenAt }[];   // not dismissed, newest first, at most 50
  recent: { id, name, amount, isExpense, category, timestamp }[];            // last 10 live email-sourced transactions
}
```

**`POST /ingestion/run`** returns `200 { created, skipped, failed }`, `409 "A check is already running"`, or `502 "The check failed: …"`.

`startAt` is the start date the ingester actually uses: a valid `INGEST_START_AT` as ISO, else `null`. `recent` items also carry `transferKind`, so transfers aren't shown as spending.

**`POST /ingestion/unreadable/:id/dismiss`** is a `findOneAndUpdate` on `_id` and `userId`, setting `dismissed: true`. It returns 204, or 404.

### Reports (`api/src/reports/`)

- **A turned-off report is skipped, on every path.** A stale-claim takeover of a turned-off report closes it as `skipped` instead of sending it. When email isn't configured, the run still records turned-off periods (it continues rather than stopping) and warns once. Before claiming a period, the scheduler reads `reports.weekly` / `reports.monthly`. A turned-off report creates its `ReportSend` as `skipped` (duplicate-key tolerant, like the expiry path) and logs "Not sending weekly report 2026-W40: turned off in Settings".
- **The recipient comes from Settings.** The scheduler and `POST /reports/test` pass the resolved recipient to `MailerService.send`, which uses the `to` it's given instead of reading `REPORT_TO`. With no resolved recipient the send fails as "not configured".

---

## Web

- **Route and nav.** A `/settings` route, last in the sidebar (`settings` icon). The gear dropdown gets a "Settings" router link above the Authentik profile link.
- **The Dashboard's** "Email me a test digest" button and its code are removed.

### Section "Bank mail"
- **Status line:** "Last checked {time} · booked N · skipped N · couldn't read N", or "Not checked yet".
- **Error line:** if `lastError` is newer than `lastRun`, a `role="alert"` line: "The last check failed at {time}: {message}".
- **Reading mail since** {startAt}, read-only.
- **Check mail now** (`.fc-btn--primary`). While `running` is true, the section re-reads the status every 4 seconds, so the button never stays stuck:
  - disabled while running, or when `running` is true;
  - afterwards shows "Booked N, skipped N, couldn't read N" in a `aria-live="polite"` line;
  - a 409 shows "A check is already running";
  - then reloads the section.
- **Couldn't read:** a list of sender, subject, arrival time and "tried N times".
  - Each row has **Not a transaction**, with an inline confirm ("Stop retrying this mail?" Yes / Cancel). On success the row goes away and focus moves to the next row's button, else the heading.
  - Empty state: "Every mail since {startAt} was read."
- **Recently booked from mail:** date, name, category pill, signed amount, and a "See all transactions" link to `/transactions`.

### Section "Email reports"
- Checkboxes **Weekly digest (Mondays, 7:00 AM)** and **Monthly summary (the 1st, 7:00 AM)**, each with "Last sent {date}" or "Not sent yet".
- **Send to:** an email input, with the resolved fallback as placeholder when the saved value is empty, and the source label "from the server's config".
- **Save** is disabled until something changes. Its errors show inline.
- **Send a test digest** keeps the Dashboard's behaviour and messages.

### Section "Your accounts"
- **The two lists:**
  - **Cash accounts (last 4 digits)**, help text "A transfer into one of these is money moving between your own accounts, not spending."
  - **How you appear as a sender (last 4 digits or part of your name)**, help text "Used to recognise transfers you send."
- **Each list:**
  - chips with a remove button (`aria-label="Remove {value}"`);
  - an add input plus **Add**, with Enter adding. The value is checked on the page with the api's rules, and a duplicate is refused inline.
  - a "from the server's config" label while its source is `config`.
- **Save** is disabled until something changes.
  - With an empty cash list it first asks: "With no cash accounts, every transfer is booked as spending. Save anyway?"
  - Note: "Applies to mail read from now on. Transactions already booked keep their classification."

### Behaviour
- Each section loads and saves independently, with its own error line and a request counter so a stale reply never overwrites a newer one.
- After a save, the section shows the api's returned values, and the source labels flip to saved.
- Focus goes to each form's first field on open, and returns to the triggering button after an action.
- Theme tokens only. At phone width the sections, form rows and list rows stack without horizontal scroll.

---

## Testing

Written first; each must fail before its implementation exists.

- **`SettingsService`:**
  - each fallback (saved, environment, default), with sources;
  - the recipient chain;
  - the comma-splitting of environment lists;
  - validation: bad digits, 3-character minimum, 40 maximum, duplicates in either case, over 20 entries, bad email, `null`/empty recipient clears;
  - the exact upsert writes;
  - `lastSent` from `ReportSend`.
- **Ingestion:**
  - accounts come from `SettingsService`, not `process.env`;
  - a dismissed mail is skipped before parsing;
  - an unusable mail or a throwing parser upserts `UnreadableMail` with the exact update;
  - `created` / `duplicate` deletes the record;
  - the end-of-run status write, and the failed-run status write;
  - a status-write failure doesn't fail the run;
  - `runGuarded` returns `null` while in flight;
  - the status endpoint's shape and filters;
  - dismiss 404 / 204;
  - run 409.
- **Reports:**
  - a turned-off report is recorded `skipped` and not sent;
  - the recipient comes from Settings for scheduled and test sends;
  - `MailerService` uses the given `to`.
- **Guards:** `SettingsController` and `IngestionController` in the class-level guard table.
- **Web:** `pnpm run build` clean with zero warnings; no colour literals; a preview-harness screenshot at desktop and phone width.

---

## Out of scope

- Money display (RD$), language, theme, and reset-all data: not chosen.
- Family sharing, premium and admin analytics: bot-only.
- Moving `GMAIL_*`, `MISTRAL_API_KEY`, `INGEST_START_AT` or `USD_DOP_RATE` into Settings: credentials stay in the Secret, and the start date is shown read-only.
- Reclassifying already-booked transfers after an account change.
- "Book it by hand" from an unreadable mail.

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- Every consumer of the three settings reads `SettingsService`; nothing else reads those variables.
- The unreadable-mail lifecycle is closed: recorded on failure, removed on success, skipped once dismissed.
- A turned-off report and an expired one take the same `skipped` path.

**Ambiguity resolved:**
- An empty saved list is honoured; it does not fall back.
- An empty recipient clears the saved value; it does fall back.
- Account changes are never retroactive.
- `running` reflects this pod only.
- A mail that books after being listed leaves the list without being dismissed.

**Scope:** one page with three sections over one settings store, and two small operational collections. About 10 tasks.
