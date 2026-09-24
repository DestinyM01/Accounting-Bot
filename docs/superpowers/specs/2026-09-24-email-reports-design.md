# Email Reports — Design Spec (migration sub-project 3)

**Goal:** The api emails the user a weekly digest and a monthly summary of their spending, including a health section that makes a stopped pipeline visible within a week.

**Context:** Scaling the bot to zero (sub-project 2) also stopped its Telegram notifications: the 1st-of-month summary (income, expenses, net, top 3 categories) and the 20:00 budget alert, which repeated daily while a category was over 80%. Nothing tells the user anything now unless they open the web app. The week-long bot outage of Sep 17–24 went unnoticed for the same reason.

**Migration order (revised 2026-09-24):** recurring scheduler (done) → **this** → balance set + history page → categories page → cash envelopes → settings.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Emails | **Weekly digest** (Monday 07:00) and **monthly summary** (the 1st, 07:00). No separate alerts, no daily digest | User's choice. Budget standing and health live inside the weekly digest. |
| Language | English | Matches the web app. |
| AI commentary | None | Numbers only. |
| Trigger | **Hourly check with a send-once record** | Same pattern as the recurring sweep: a restart or a refused send at 07:00 doesn't lose the report, and two pods during a rollout can't send it twice. |
| Sending window | Weekly **3 days** after due, monthly **7 days** | Past that, a report is recorded as skipped instead of arriving stale. |
| Transport | Gmail SMTP with the existing `GMAIL_USER` / `GMAIL_APP_PASSWORD` | No new credentials. Gmail accepts the app password for SMTP as well as IMAP. |
| Recipient | `REPORT_TO` if set, else `GMAIL_USER` | The address never appears in the public repository; it lives only in the Secret. |
| Loop safety | Nothing to do | The ingester reads only the `Banks` label, whose filter matches the four bank senders. A self-sent report never reaches it. |
| Figures | Reuse `StatisticsService` / `BudgetService` for every monthly figure | The email and the web can never disagree. Both exclude internal/unresolved transfers and deleted rows (`SPENDING_ONLY`). |
| Money format | `RD$ 12,345`, whole pesos | Amounts are stored in pesos. The web's plain `$` is also usual in the DR; the email is explicit. |
| Time zone | America/Santo_Domingo, UTC−4 all year, no DST | Monday 07:00 local = 11:00 UTC. Local midnight = 04:00 UTC. |
| Test path | `POST /reports/test` + one Dashboard button | The user can see the digest the day it ships instead of waiting until Monday. |

---

## Content

### Weekly digest

Due Monday 07:00 Santo Domingo; covers the previous Monday 00:00 to this Monday 00:00 local (`[Mon 04:00Z, next Mon 04:00Z)`).

**Subject:** `Weekly digest · Sep 21–27 · RD$ 18,450 spent` (a week spanning two months reads `Sep 28 – Oct 4`).

1. **Last week** — spent, income; the top 5 expense categories, each with its share of the week's spending; the 3 largest expenses (display name, day, amount). Display name = `merchant` if present, else `transactionName`.
2. **{Month} so far** — the current month's spent, income and net (`StatisticsService.summary()`), then every budget of the current month (`BudgetService.get()`): spent / limit and a status —
   - `over by RD$ X` when spent > limit;
   - `≥ 80%` when spent ≥ 0.8 × limit;
   - `on track` otherwise.

   Computed from `spent` and `limit`, not `percentage` (which `BudgetService` caps at 100). Status is text, not colour alone.
3. **Waiting for you** — shown only when either count is non-zero:
   - transfers waiting for Internal/Expense: `transferKind: 'unresolved'`, not deleted;
   - categories to review: `categoryNeedsReview: true`, not deleted;
   - a link to Transactions.
4. **Health** — one line when all is well: *Recurring payments and bank emails are up to date.* Otherwise one line per problem:
   - **Recurring not booked:** an active rule for which `planOccurrences(rule, now − 2 h).due` is non-empty — a due occurrence more than two hours old that the sweep has not handled, i.e. at least two missed sweeps. The line names the rule and the earliest overdue day: *Recurring "gym" was due Sep 20 and hasn't been booked.*
   - **Ingestion stale:** the newest `source: 'email'` transaction, deleted or not (freshness is about the pipe, not the row), dated by its ObjectId (when it was ingested). If there is none, or it is older than 3 days: *No bank email ingested since Sep 19 (5 days).* The date of the last ingested email is always shown, problem or not.

### Monthly summary

Due the 1st at 07:00 Santo Domingo; covers the previous calendar month.

**Subject:** `September 2026 · RD$ 61,200 spent · net +RD$ 13,800` (net is signed: `+RD$` / `−RD$`).

1. Income, expenses, net (`StatisticsService.summary(m, y)`), and the change in expenses against the month before, `+12%` / `−8%`. The change is omitted when the earlier month had no expenses.
2. Spending by category, largest first, each with its share (`StatisticsService.byCategory(m, y)`).
3. Budgets of that month (`BudgetService.get(m, y)`): limit, spent, `under by RD$ X` / `over by RD$ X`. The section is omitted when there were none.

The monthly figures use the same month boundaries as the web (the api process's clock, UTC in the cluster). A transaction at 22:00 local on the 30th therefore counts in the next month, exactly as it does on the dashboard.

No "waiting for you" or health: the Monday digest carries those, so a Monday the 1st doesn't repeat them.

### Both

- HTML with a plain-text alternative carrying the same sections.
- The HTML is inline-styled, single column, max-width 600 px, with a system font stack. No images, web fonts or external resources.
- A footer link to the dashboard: `CORS_ORIGIN`, already set in the manifest.
- **Every interpolated name** (merchant, transaction, rule, category) is HTML-escaped. Bank and user text never reaches the HTML raw.

---

## Components — `api/src/reports/`

| Unit | Kind | Responsibility |
|---|---|---|
| `report-periods.ts` | pure | Which weekly and monthly period is the latest due, its covered range, its key, and whether its window has expired |
| `report-data.service.ts` | Nest service | Gathers the numbers for a period (reusing statistics and budget services; own queries for week totals, largest expenses, waiting counts, health) |
| `report-render.ts` | pure | Data → `{ subject, html, text }`, including all escaping and formatting |
| `mailer.service.ts` | Nest service | Gmail SMTP via `nodemailer`; `isConfigured()`, `send({ subject, html, text })` |
| `report-scheduler.service.ts` | Nest service | Hourly at :20: claim → build → render → send → mark, with retry and expiry |
| `reports.controller.ts` | Nest controller | `POST /reports/test`, JWT-guarded |
| `api/src/shared/schemas/report-send.schema.ts` | schema | The send-once record |

`StatisticsModule` and `BudgetModule` gain `exports: [StatisticsService]` / `exports: [BudgetService]`. `ReportsModule` imports them, registers `Transaction`, `Recurring` and `ReportSend` models, and is added to `AppModule`. New dependency: `nodemailer` (+ `@types/nodemailer` as a dev dependency).

### `report-periods.ts`

```ts
export type ReportKind = 'weekly' | 'monthly';
export interface ReportPeriod {
  kind: ReportKind;
  key: string;     // weekly: ISO week of the covered Monday, 'YYYY-Www'; monthly: 'YYYY-MM' of the covered month
  from: Date;      // covered range, inclusive
  to: Date;        // covered range, exclusive
  dueAt: Date;     // weekly: Monday 11:00Z; monthly: the 1st 11:00Z
  expired: boolean; // now − dueAt > 3 days (weekly) / 7 days (monthly)
}
export function latestPeriods(now: Date): ReportPeriod[]; // one weekly, one monthly: the latest with dueAt ≤ now
```

- Weekly `from`/`to` are local midnights (04:00Z).
- Monthly `from`/`to` are the covered month's first instant and the next month's first instant, in process time. They are used only for the key and the subject; the figures come from `StatisticsService`.
- ISO weeks: the week-year can differ from the calendar year. The week starting Mon 2025-12-29 is `2026-W01`; 2026 has 53 weeks (it starts on a Thursday), so the week starting Mon 2026-12-28 is `2026-W53`.
- Only the latest period of each kind is ever considered. Older ones are neither sent nor recorded.

### `ReportSend` — the send-once record

```ts
@Schema()
export class ReportSend extends Document {
  @Prop({ required: true }) kind: string;    // 'weekly' | 'monthly'
  @Prop({ required: true }) period: string;  // the period key
  @Prop({ required: true }) status: string;  // 'sending' | 'sent' | 'skipped'
  @Prop({ required: true }) at: Date;        // when status was last set
}
// unique index { kind: 1, period: 1 }
```

api-only (the bot is retired), so there is no mirror.

### `report-scheduler.service.ts`

`@Cron('20 * * * *', { waitForCompletion: true }) poll()` → `run(new Date())`, with a `running` flag as in ingestion and the recurring sweep. Minute 20 falls after the recurring sweep at :05, so Monday's digest includes that morning's bookings.

For each period from `latestPeriods(now)`:

1. **Record exists** with status `sent` or `skipped` → nothing.
2. **Record exists** with status `sending` and `at` older than 30 minutes → a pod died mid-send. Reclaim it atomically (`findOneAndUpdate` on `{ kind, period, status: 'sending', at: { $lt: now − 30 min } }` → `at: now`) and continue at step 5. Any other `sending` record → another pod is on it → nothing.
3. **Expired** → insert `{ status: 'skipped', at: now }` (ignore `11000`) and log one warning. It is never sent late and never re-logged.
4. **Mailer not configured** → log a warning and stop the run without recording anything, so nothing is lost when credentials are added later.
5. **Claim:** insert `{ status: 'sending', at: now }`. On `11000`, another pod claimed it → nothing.
6. **Build → render → send.** On success, set `status: 'sent', at: now`. On any error, delete the claim (the next hour retries) and log the error with kind and period.

The run logs one line only when something happened: `Report run: sent N, skipped K, failed F`.

### `mailer.service.ts`

`nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })`, created lazily.

- `isConfigured()` is true when both variables are set.
- `send()` uses `from: "AccBot" <GMAIL_USER>` and `to: REPORT_TO || GMAIL_USER`.
- It never logs the recipient address or the password.

### `POST /reports/test`

Behind `JwtAuthGuard`, asserted in a test.

- Builds the digest for the latest weekly period (ignoring its window) and renders it with a `[Test] ` subject prefix. It sends immediately and records nothing.
- Returns `202 { ok: true }`, or `503` (`Email is not configured on the server`) when the mailer is not configured.

### Web

On the Dashboard header (`.dash-header`), one ghost button **"Email me a test digest"** (`.fc-btn fc-btn--ghost`), with four states:
- idle;
- sending: disabled, "Sending…";
- sent: "Sent — check your inbox" for 5 seconds;
- error: inline `.fc-error` text. A 503 reads "Email isn't configured on the server"; anything else "Couldn't send the test email".

`ApiService.sendTestDigest()` makes the call. This is the only web change.

---

## Config

| Variable | Required | Source | Purpose |
|---|---|---|---|
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | already set | Secret | SMTP login and the default recipient |
| `REPORT_TO` | no | Secret, `optional: true` | Send reports to another address |
| `CORS_ORIGIN` | already set | manifest | Dashboard links |

README and `.env.example` document `REPORT_TO` with a placeholder only.

---

## First deploy

On a deploy any time before Monday Sep 28 at 11:00 UTC:
- The latest weekly period (due Mon Sep 21) and the latest monthly period (due Sep 1) are both past their windows. They are recorded `skipped` with one warning each, so there are no surprise emails.
- The first real digest arrives **Monday Sep 28 at 07:00**; the first summary on **Oct 1**.
- The test button shows the digest the day it ships.

---

## Testing

Written first; each must fail before its implementation exists.

**`latestPeriods`**
- Monday 10:59Z → the latest weekly is still last Monday's. At 11:00Z → today's, covering the previous Mon 04:00Z → this Mon 04:00Z.
- The week key at year boundaries: the Monday 2025-12-29 week → `2026-W01`; the Monday 2026-12-28 week → `2026-W53`; the Monday 2027-01-04 week → `2027-W01`.
- Monthly on the 1st at 11:00Z → the previous month (January → the previous December); on the 1st at 10:59Z → the month before that.
- Windows: weekly expired just after 3 days, not at exactly 3 days; monthly after 7.

**`report-render`**
- Weekly and monthly subjects exactly as specified, including a week spanning two months, `+`/`−` net, and whole-peso formatting.
- Sections:
  - "Waiting for you" is absent at zero and present with a count;
  - health shows the "up to date" line, or one line per problem;
  - the month-over-month change is absent when the earlier month had no expenses;
  - the budget section is absent without budgets.
- Budget status: `over by`, `≥ 80%`, `on track`, each at its boundary (exactly 80% → `≥ 80%`; spent = limit → not over).
- A merchant named `<script>alert(1)</script>` and a rule named `A & B "quoted"` come out escaped in the HTML and verbatim in the text.

**`ReportDataService`** (models mocked)
- Week totals and categories query `SPENDING_ONLY` over `[from, to)`; the largest expenses are sorted by amount.
- Waiting counts use `NOT_DELETED`.
- Recurring health: a rule overdue by 3 hours is flagged; overdue by 1 hour is not; a handled month is not.
- Ingestion health: the newest email row 2 days old → fine; 4 days → flagged; none → flagged.

**`ReportSchedulerService`** (models, mailer, data and render mocked)
- Due and unrecorded → claim, send once, mark `sent`.
- Send throws → claim deleted, nothing marked, error logged with kind and period.
- `11000` on claim → no send.
- A `sent`/`skipped` record → nothing.
- A `sending` record older than 30 minutes → reclaimed and sent. A fresh one → nothing.
- Expired → `skipped` recorded, no send, one warning.
- Mailer not configured → nothing recorded, no send.
- `running` guard.
- Cron `'20 * * * *'` with `{ waitForCompletion: true }` registered (recording stub, as in the recurring spec).

**`MailerService`** — transport options; recipient defaults to `GMAIL_USER`; `REPORT_TO` overrides; `isConfigured()` false when either credential is missing.

**`ReportsController`** — `JwtAuthGuard` on the controller (pinned via `GUARDS_METADATA`, as in `transactions.controller.spec.ts`); 503 when not configured; `[Test] ` prefix; records nothing.

**Regression** — api and repo suites green; web `pnpm run build` clean with zero warnings.

---

## Out of scope

- Budget and health alerts between digests (declined for now; the digest carries both).
- A daily digest, Mistral commentary, Spanish.
- Ingestion parse failures (`Unusable mail`, `failed=N`) in the health section. They exist only in logs today; surfacing them needs the ingester to persist run results — a follow-up.
- Changing the schedule or turning emails off from the web (the settings sub-project).

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- One send-once record per `(kind, period)` decides everything. `sent` and `skipped` are final.
- `sending` is either in progress (under 30 minutes) or stale and reclaimable.
- The only unrecorded path is "not configured".
- The test endpoint never touches the record.
- Every monthly figure comes from the same services as the web.

**Ambiguity resolved:**
- "Latest period" means the latest with `dueAt ≤ now`.
- Windows are exclusive at the boundary (exactly 3 days is still sendable).
- "Overdue" means more than two hours past the due moment.
- Ingestion freshness counts deleted rows.
- The digest's month-so-far section always refers to the month of the send time.

**Scope:** one goal — the api tells the user where their money stands, on a schedule. The web change is one button.
