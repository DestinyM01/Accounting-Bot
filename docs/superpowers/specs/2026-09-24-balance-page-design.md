# Balance Page — Design Spec (migration sub-project 4)

**Goal:** The web can set the balance to the total the user's accounts actually show, and shows how the balance got where it is: a 90-day chart and the full history, filterable by kind.

**Context:**
- The api exposes only `GET /balance`, which the Dashboard shows as a stat card. The web has no way to correct the balance or see its history.
- The bot had both. Its "change balance" scene read the balance, then saved a new one, so a transaction landing in between was silently overwritten. Its history view listed the last 20 entries.
- `LedgerService` already writes a `BalanceHistory` row for every movement — income, expense, delete, manual, recurring — so the history exists back to the bot era. It only needs to be shown.

**Migration order (revised 2026-09-24):** recurring scheduler (done) → email reports (done) → **this** → categories page → cash envelopes → settings.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Where | **Its own Balance page**, second in the nav; the Dashboard's balance card links to it | User's choice. |
| What "Set balance" means | **The user types the total their accounts show**; the page previews the difference and asks to confirm; optional note | Reconciliation against reality is the use: the user reads the total, not the difference. |
| How it is recorded | One `BalanceHistory` row, reason `manual`, the note as its name. **Never** a transaction: it is not income or expense in any statistic or budget | It corrects the balance; it is not spending. |
| Atomicity | `LedgerService.setTo(target, note)` — one `findOneAndUpdate` with `$set`, reading the replaced value from the pre-image | No concurrent movement can be lost. `LedgerService` stays the only code in `api/` that moves the balance. |
| Negative totals | Allowed | An overdrawn account is real. |
| Chart data | **Computed in the api** from history: one closing balance per Santo Domingo day | The day-bucketing lives where it can be tested (the web has no test runner). |
| Chart source | History only, never mixed with the live balance. The one exception is when there is no history at all, which gives a flat line at the live balance | A missing history row (the ledger logs and swallows history failures) shows as a visible step instead of being papered over. |
| Filters | **Single-choice chips**: All · Income · Expense · Deleted · Set by you · Recurring | User's choice. One active at a time; the chart is not filtered. |
| Money display | The web's existing `$` currency formatting | Consistent with every other page. |
| Chart colours | Read from theme tokens at runtime (`getComputedStyle`), never hex | The Hallmark token rule. The Dashboard's chart still hard-codes its colours; recorded as a follow-up. |

---

## API

All routes stay under the existing class-level `JwtAuthGuard` of `BalanceController`, pinned in a test.

### `LedgerService.setTo(target: number, note?: string)`

```ts
const before = await this.balanceModel.findOneAndUpdate(
  { userId: this.userId },
  { $set: { balance: target, lastActivity: new Date() } },
  { upsert: true, new: false, setDefaultsOnInsert: true },
);
const previousBalance = before?.balance ?? 0;
const delta = round2(target - previousBalance);
```

- When `delta === 0`, no history row is written.
- Otherwise it writes `{ previousBalance, newBalance: target, delta, reason: 'manual', transactionName: note }`. As in `apply`, a history failure is logged and never undoes the movement.
- It returns `{ previousBalance, newBalance: target, delta }`.
- With no `Balance` document yet, the upsert creates one and `previousBalance` is 0.

### `PUT /balance` — body `{ balance: number; note?: string }`

Validation: every failure is a 400 with a message.

- **`balance`:** a `number`, `Number.isFinite`, `|balance| ≤ 1e12`, rounded to cents (`Math.round(x * 100) / 100`).
- **`note`:** optional. It must be a string; it is trimmed, and must be ≤ 100 characters after trimming. An empty string is treated as absent.

Response `200 { previousBalance, newBalance, delta }`.

### `GET /balance/history?limit=20&offset=0&reason=`

- `limit`: integer, clamped to 1..100; default 20. `offset`: integer ≥ 0; default 0.
- `reason`: optional, one of `income | expense | delete | manual | recurring`. Anything else is a 400.
- Order: `timestamp` descending, then `_id` descending.
- Response `{ items: [{ id, timestamp, reason, delta, newBalance, name }], total }`. `name` is `transactionName` or `null`. `total` counts the filtered set.

### `GET /balance/daily?days=90`

`days`: integer clamped to 7..365; default 90. Response: `days` points `[{ day: 'YYYY-MM-DD', balance }]`, oldest first, the last being today (Santo Domingo).

- **Window start:** local midnight `days − 1` days before today = `Date.UTC(y, m, d − (days − 1), 4)`, where `y/m/d` is today's local date. Santo Domingo is UTC−4 all year, so local midnight is 04:00 UTC.
- **Rows:** history with `timestamp ≥ windowStart`, ascending.
- **Opening balance,** in order of preference:
  1. the `newBalance` of the latest row before `windowStart`;
  2. the `previousBalance` of the earliest row in the window;
  3. the current `Balance` document's `balance` (a flat line);
  4. 0.
- **Each day's closing** is the `newBalance` of that local day's last row, else the previous day's closing (starting from the opening).

The bucketing is a pure function in `api/src/balance/daily-closings.ts`:

```ts
export function dailyClosings(input: {
  windowStart: Date;   // local midnight of the first day
  days: number;
  opening: number;
  rows: { timestamp: Date; newBalance: number }[]; // ascending, all ≥ windowStart
}): { day: string; balance: number }[];
```

Local day of a timestamp = the UTC calendar date of `timestamp − 4 h`.

### Schema and wiring

- `BalanceHistorySchema.index({ userId: 1, timestamp: -1 })`. Only the api reads it this way; the retired bot's mirror needs nothing.
- `BalanceModule` imports `LedgerModule` and registers the `BalanceHistory` model for reads.

---

## Web

### Navigation

- `{ label: 'Balance', icon: 'account_balance', path: '/balance' }`, second in `app.component.ts`'s nav array.
- A lazy route `/balance`, like the others.
- The Dashboard's balance stat card links to `/balance`: `StatCard` gains an optional `link`, and the card renders as a router link when it is present.

### The page, top to bottom

1. **Header:** the current balance, large (`GET /balance`), and "Last activity" with its date and time. A **Set balance** button (`.fc-btn fc-btn--primary`).
2. **Set-balance form** — inline, shown by the button:
   - An amount input (`type="number"`, `step="0.01"`), prefilled with the current balance, and a note input (`maxlength="100"`, placeholder "Why? (optional)").
   - A live preview line: *"This records an adjustment of −$1,230 (from $52,400 to $51,170)."* When the amount equals the current balance: *"No change."*
   - **Confirm** is disabled while the amount is invalid or unchanged, or while saving. **Cancel** closes the form.
   - On success: close the form, `TransactionEventsService.notify()` (the Dashboard refreshes too), and reload the header, the chart and the list from page one, keeping the active filter.
   - On failure: `.fc-error` with `role="alert"` under the form. The rest of the page is untouched.
3. **Chart:**
   - A Chart.js line with `stepped: true`, no point dots, fixed height, fitting the container width, over `GET /balance/daily?days=90`.
   - Colours come from `--accent` (line), `--border` (grid) and `--text-muted` (ticks), read with `getComputedStyle(document.documentElement)`.
   - Destroyed on component destroy. Rebuilt without animation on reload, as the Dashboard does.
4. **Filters:** chips — All, Income, Expense, Deleted, Set by you, Recurring. They are buttons with `aria-pressed`, and only one is active. Changing the chip reloads the list from page one.
5. **History list:** 20 per page, **Load more** while `items.length < total`. Each row shows:
   - local date and time;
   - the name, or for `manual` rows the note, else "Balance set";
   - the kind label;
   - the change, signed (`+$1,200` / `−$350`) and coloured with `--income` / `--expense`, the sign always shown so colour is never the only cue;
   - the balance after.

   Empty state: "No history for this kind yet."

### States

- First load: a page-level "Loading…".
- Section errors show inline in their section; a failed chart load does not hide the list, and vice versa.
- Load more shows its own "Loading…" and stays in place on failure, with an inline error.
- Phone width: the header stacks, the form fields stack, the chips wrap, the chart keeps its height, and the list rows wrap without horizontal scroll.

### Styling

- Shared `_form-controls.scss` classes for the inputs and buttons.
- The page stylesheet uses `var(--…)` tokens only: no hex, rgb or oklch.

---

## Testing

Written first; each must fail before its implementation exists.

**`LedgerService.setTo`** (models mocked)
- The exact `findOneAndUpdate(filter, { $set: { balance, lastActivity } }, { upsert: true, new: false, setDefaultsOnInsert: true })`.
- `previousBalance` from the pre-image; `delta` rounded to cents.
- History row `{ previousBalance, newBalance, delta, reason: 'manual', transactionName: note }`.
- The same target as current → no history row, `delta` 0.
- No document yet (pre-image `null`) → `previousBalance` 0.
- A history failure is logged; the result is still returned.

**`dailyClosings`**
- A day with no rows carries the previous closing forward.
- The last row of a day wins.
- A row at 03:59 UTC counts on the previous local day; a row at 04:00 UTC counts on its own day.
- `days` points exactly; the first point is the opening when day one has no rows.
- No rows: a flat line at the opening.

**`BalanceService` / `BalanceController`**
- `PUT` validation: string, `NaN`, `Infinity`, over 1e12, a non-string note, a note over 100 characters → 400.
- Rounding to cents; the note is trimmed; an empty note is absent.
- History: default and clamped `limit`; `offset`; the reason filter passed to the query and to `countDocuments`; an unknown reason → 400; the sort; `name` null when absent.
- Daily: the opening from the latest earlier row, else the earliest window row's `previousBalance`, else the current balance, else 0; `days` clamped.
- `JwtAuthGuard` on `BalanceController` at class level.
- `BalanceHistorySchema` declares the `{ userId: 1, timestamp: -1 }` index.

**Web** — `pnpm run build` clean with zero warnings; no colour literals in the diff.

---

## Out of scope

- The Dashboard chart's hard-coded colours (follow-up: move them to tokens the way this page does).
- Linking history rows to their transactions (the Transactions page has no deep link by id).
- Editing or deleting history rows. The history is an audit trail; corrections go through a new manual set.
- Per-account balances. The balance stays one total across accounts and cash.

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- Every balance change still goes through `LedgerService`: `apply` for movements, `setTo` for corrections. Both write history the same way.
- The chart and the list read the same history.
- The header reads the live balance, and the spec says why they may differ.

**Ambiguity resolved:**
- A set to the unchanged total records nothing.
- A negative total is allowed.
- A manual set is never a transaction.
- Filters are single-choice and affect only the list.
- "Today" and day boundaries are Santo Domingo local time.
- `days` and `limit` are clamped, not rejected.

**Scope:** one page and three endpoints over data that already exists.
