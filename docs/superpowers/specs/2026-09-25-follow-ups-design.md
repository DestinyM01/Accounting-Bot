# Follow-ups Round — Design Spec

**Goal:** Close the follow-ups the user picked from the triage:
- (1) the ones a user would notice;
- (2) "Load more" paging that can skip rows, together with balance-history order;
- (3) build and internal cleanup.

Follow-ups accepted by design stay as they are and aren't touched.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Muted text contrast | `--color-ink-2` from 48% to **60%** lightness, which gives 4.8–5.1:1 on every background. |
| Review dropdown and the keyboard | Arrow keys only move the choice. The row is filed on **Enter or when focus leaves** the dropdown. Mouse and touch choices file immediately. |
| Recurring on phones | Summary cards, rule rows and the bottom panels stack. The flow chart stays hidden at ≤ 700 px. |
| Paging | **Cursor** paging ("the rows after this one") for Transactions and Balance history. Offset paging is kept as a fallback. |
| History order | A **`seq` counter** on the balance record, incremented in the same atomic write as the balance, and stored on each history row. |
| Recurring edge failures | A **`failedPeriod`** on the rule is retried every hour until it books. |

## Part 1 — Fixes a user would notice

### 1.1 Recurring page at phone width (`web/src/app/pages/recurring/`)

At ≤ 640 px:
- **Summary cards:** `.summary-row` becomes one column.
- **Rule rows:** the header row of the scheduled-items table is hidden, and each item row stacks:
  - icon and name;
  - "Every {n}th · {Category}";
  - the amount and the delete button.
- **Bottom panels:** "Upcoming next" and "Billed this month" become one column.
- **New-rule form:** its row wraps.

The page has no horizontal scroll at 375 px. The flow panel keeps its existing ≤ 700 px hide.

### 1.2 Readable secondary text (`web/src/tokens.css`)

`--color-ink-2: oklch(60% 0.02 230);` (was 48%). Every consumer of `--text-muted` follows, the charts' axis ticks included.

### 1.3 Budget "View All" (`web/src/app/pages/budget/budget.component.html`)

Remove the `<span class="link">View All</span>`. Every category card is already shown below it.

### 1.4 Review dropdown and the keyboard (`web/src/app/pages/transactions/`)

- **Keyboard choices wait.** A `keydown` on the review `<select>` for ArrowUp/Down/Left/Right, Home or End marks the select as "keyboard-picking". While it's marked, `change` doesn't file.
- **Filing a keyboard choice.** Enter files the current value. So does `blur`, if the value differs from the guess. The mark then clears.
- **Pointer choices.** A `change` without the mark files immediately, as now.
- **Escape** restores the guess and clears the mark, without filing.

### 1.5 Merchants status next to the change (`web/src/app/pages/merchants/`)

- **Where the message shows.** The status message renders directly under the row that changed. After a forget, it goes under the row that now holds that position, else at the list's end. After an add, it goes under the Add merchant section.
- **Screen readers.** One `aria-live="polite"` region still carries the text, so it's announced once. The visual copy is `aria-hidden`.

### 1.6 Very large Calculator results (`web/src/app/pages/calculator/`)

One formatter for every money figure on the page:
- **below 1e12:** the current `$1,234,567` format;
- **1e12 up to 1e15:** compact, for example "$1.4T";
- **1e15 and above:** "over $999T".

The chart's tick labels use the same formatter.

### 1.7 Cash panel closed mid-add (`web/src/app/pages/transactions/cash-panel/`)

When an add succeeds after the panel has closed, its reply still updates the row's "not itemized" figure. The page is told through the existing row-update output or `TransactionEventsService`; the plan picks whichever the component already uses.

### 1.8 Balance chart loading (`web/src/app/pages/balance/`)

While the daily data loads, the chart section shows "Loading…" in place of an empty box. An error keeps its current message.

### 1.9 A stuck counter no longer blocks amount edits (`api/src/cash/`, `api/src/transactions/`)

- **The helper.** `CashService.repairCounter` moves to an injectable `CounterRepairService` (`api/src/cash/counter-repair.service.ts`). It keeps the same behaviour and the same known limit. `CashService.add` uses it.
- **Where the amount edit is refused.** In `TransactionsService.update`, when an amount edit on a withdrawal is refused because `allocatedCash` exceeds the new amount, the service repairs once and re-evaluates the check. That covers both the pre-check and the guarded write's miss.
- **The refusal after a repair.** If the edit is still refused, the error names what the items actually hold.
- **Module wiring.** `TransactionsModule` gets the service without a module cycle. If `CashModule` imports `TransactionsModule`, the repair service lives in a small module both import.

### 1.10 Settings "Use the server's config" (`api/src/settings/`, `web/src/app/pages/settings/`)

- **Api.** `DELETE /settings/reports` and `DELETE /settings/accounts` remove the saved section and answer 204, including when nothing is saved. The section then reads from env again, through the existing `SettingsService` fallback.
- **Web.** A section whose source is "Saved here" shows a ghost button, "Use the server's config". It asks for confirmation inline, then calls the delete and reloads the section.

### 1.11 Unreadable mails outside the window (`api/src/ingestion/`)

After fetching, each run deletes `UnreadableMail` records whose `receivedAt` is before the run's `since`. Those mails can't be fetched again.

## Part 2 — "Load more" and history order

### 2.1 Transactions cursor (`api/src/transactions/`, web Transactions page)

- **Sort.** `{ timestamp: -1, _id: -1 }`.
- **The `before` parameter** takes a cursor `"<ISO timestamp>_<id>"` and adds `$or: [{ timestamp: { $lt: t } }, { timestamp: t, _id: { $lt: id } }]` to every filter (with `$and`). A malformed cursor answers 400.
- **The reply** adds `nextCursor`: the cursor of the last row when a full page came back, else `null`.
- **`offset`** is still honoured when `before` is absent.
- **The web's "Load more"** sends `before=nextCursor` and shows only while `nextCursor` is non-null. Filters and search reset the cursor.

### 2.2 Balance history order and cursor (`api/src/shared/ledger/`, `api/src/balance/`, web Balance page)

- **The counter.**
  - `Balance` gains `seq: number`.
  - `LedgerService.apply` adds `$inc: { seq: 1 }` to its atomic update (`new: true`). The history row gets `seq: updated.seq`.
  - `setTo` adds `$inc: { seq: 1 }` (`new: false`). The row gets `seq: (before?.seq ?? 0) + 1`.
- **Storage.** `BalanceHistory` gains optional `seq: number`, and an index `{ userId: 1, seq: -1 }`.
- **History order.** `{ seq: -1, timestamp: -1, _id: -1 }`. Rows without `seq` are older and sort after all rows with it.
- **The history cursor** is `s<seq>` for a row with `seq`, or `t<ISO>_<id>` for one without.
  - **After `s<n>`:** `{ $or: [{ seq: { $lt: n } }, { seq: { $exists: false } }] }`.
  - **After `t<ISO>_<id>`:** `{ seq: { $exists: false }, $or: [{ timestamp: { $lt: t } }, { timestamp: t, _id: { $lt: id } }] }`.

  Combined with the reason filter. The reply adds `nextCursor`, and a malformed cursor answers 400.
- **Daily closings.** The rows the daily chart reads are sorted `{ timestamp: 1, seq: 1, _id: 1 }`, so a day closes on its last change. The opening-balance lookup (the last row before the window) sorts `{ timestamp: -1, seq: -1, _id: -1 }`.
- **Web.** "Load more" on the Balance page uses `nextCursor`.

## Part 3 — Build and cleanup

### 3.1 Reproducible images

- **The api Dockerfile builder:**
  - `RUN npm install -g pnpm@11.3.0`;
  - `COPY package.json pnpm.json pnpm-lock.yaml pnpm-workspace.yaml ./`, plus `.npmrc` if `api/` has one;
  - `RUN pnpm install --frozen-lockfile`.
- **The web Dockerfile** pins `pnpm@11.3.0` too; it already uses its lockfile.
- **Before shipping,** `pnpm install --frozen-lockfile` must pass in a clean copy of `api/`.

### 3.2 A recurring edge failure is retried (`api/src/recurring/`, `api/src/shared/schemas/recurring.schema.ts`)

- **The field.** `Recurring.failedPeriod?: string`.
- **Setting it.** When a booking fails, the sweep sets it to the occurrence's period if it's empty or later: `$min` semantics on 'YYYY-MM' strings.
- **Planning.** `planOccurrences` treats an occurrence whose period equals `failedPeriod` as **due**, even when it's older than the 31-day window. Other occurrences keep today's rules.
- **Clearing it.** Marking a period handled `$unset`s `failedPeriod` once `lastPeriod` is at or past it.

### 3.3 Reports

- **Month names are defined once.** The name list lives in `report-render.ts`. `report-data.service.ts` carries the month number instead of `label`: `WeeklyReportData.month` and the monthly equivalent. The render names it.
- **Typed schema fields.** `ReportSend.kind` is `'weekly' | 'monthly'` and `status` is the scheduler's status union, each with `@Prop({ type: String })`.

### 3.4 Shared helpers

- **Web focus helper.** `web/src/app/core/ui/focus.ts` exports `focusFirst(...ids: string[]): void`: after the next render, it focuses the first element that exists. Categories, Merchants and Transactions (`focusSoon`) use it; their component-specific guards stay.
- **Danger button.** `.fc-btn--danger` in `web/src/styles/_form-controls.scss` replaces `.cat-danger` and `.mer-danger`.
- **Api test stub.** `api/src/test-utils/query-stub.ts` exports a chainable query stub. The balance and report-data specs use it instead of their own.

### 3.5 Chart colours by formula (`web/src/app/core/ui/chart-theme.ts`)

`toRgb` parses `oklch(L% C H [/ A])` and converts it with the standard OKLab → linear sRGB → sRGB formula, clamped to 0–255. Any other colour string passes through unchanged. The canvas and its cache go.

### 3.6 Old status fields (`api/src/ingestion/ingestion-status.service.ts`)

`recordRun` adds `$unset: { skipped: '', failed: '' }` with `{ strict: false }` on that update.

## Testing

- **Api:**
  - **counter repair:** amount-edit repair and retry, and no repair when the counter is right;
  - **settings:** the DELETE routes (204) and the env fallback afterwards;
  - **unreadable mails:** records before `since` are deleted;
  - **Transactions cursor:** ties at the same time, filters combined, a malformed cursor (400), the last page (`nextCursor` null), and offset still working;
  - **Ledger:** `seq` is incremented inside the same update, for apply and setTo;
  - **Balance history:** ordering and cursors across rows with and without `seq`, with the reason filter;
  - **Recurring:** `failedPeriod` set on failure (the earliest wins), retried past the window, cleared when handled;
  - **Reports:** the month number and the rendered name;
  - **Status record:** `recordRun`'s `$unset`.
- **Build:** `pnpm install --frozen-lockfile` passes in a clean copy of `api/`.
- **Web:**
  - a clean build;
  - preview screenshots: Recurring at 375 px, the brighter muted text, the Merchants status under a changed row, a huge Calculator result and the Balance chart loading;
  - the dropdown keyboard behaviour, driven by synthetic key events.
