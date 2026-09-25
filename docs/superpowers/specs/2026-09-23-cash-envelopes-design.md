# Cash Envelopes — Design Spec (migration sub-project 6)

**Goal:** Let an ATM withdrawal be broken down into what the cash was actually spent on. Cash spending then reaches category budgets without being counted as an expense twice.

**Context:** Card spending is captured automatically from bank emails, but cash is not. A withdrawal arrives as one opaque lump, and every peso of it is invisible to budgets. The user's framing: *"it doesn't add more to the expenses count but it goes directly into the amount like a detailed report of where was it spent."*

**Revised 2026-09-24.** The first version predates three changes: the bot's retirement (it now runs at zero replicas), recurring moving into the api, and the categories page. The revision:
- drops the bot;
- routes every per-category view through one calculation;
- makes over-allocation impossible even with concurrent requests;
- ties allocations into the categories page's usage and moves;
- leaves existing withdrawals where they are (the user's choice).

**Migration order:** recurring scheduler (done) → email reports (done) → balance page (done) → categories page (done) → **this** → settings → compound-interest calculator.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Category weight | **Items own their category's share; the withdrawal keeps the total** | The only way cash spending stops being invisible to budgets. |
| Storage | **A separate `CashAllocation` collection** | Every query on `Transaction` stays correct without change. See below. |
| Input surface | **Web only**, on the Transactions page | Telegram now charges in the DR, and the bot is retired. |
| What can be itemized | **Detected ATM withdrawals only** | An envelope always has a real bank record behind it, never a typed-in amount. |
| New withdrawals' category | **A dedicated built-in `cash`** | `cash` reads as "withdrawn and not yet accounted for". |
| Existing withdrawals | **Left where they are** | The user's choice. They can still be itemized; their remainder stays in their current category. |
| The bot | **Not changed** | It is retired. If it is ever revived, it needs `cash` in its `Category` enum and `allocatedCash` in its `Transaction` schema. |
| Per-category views | **All five go through one `CategorySpendService`** | Budget, Statistics, the weekly and monthly emails, Compare and Tips must give one answer to "what did I spend on food". |
| Over-allocation | **Impossible, even concurrently**: a guarded reservation on the withdrawal | Single-node MongoDB has no transactions; a counter changed only by guarded writes stands in for one. |
| When items count | **In the withdrawal's month, while the withdrawal is live** | The cash left the bank then; a deleted withdrawal takes its items out of every total. |
| Balance | **Items never touch `Balance` or `BalanceHistory`** | The withdrawal already moved the balance. |

---

## The model

```
Transaction  (withdrawal)          $5,000   ← owns the TOTAL, moved the balance
  └─ CashAllocation  food          $3,000   ← owns CATEGORY weight only
  └─ CashAllocation  transport     $1,500
  └─ (not itemized)                $  500   ← stays in the withdrawal's own category (cash)
```

**The invariant:** a withdrawal's own category weight is `|amount| − Σ its items`. Always.

- **Nothing double-counts.** Items never touch the total or the balance, so total spending is unchanged and the category totals still add up to it.
- **Nothing vanishes.** Cash that isn't itemized stays visible under the withdrawal's category.
- **Partial itemization just works.** There is no all-or-nothing and no draft state.

### Why a separate collection

Every query on `Transaction` (lists, totals, balance, exports) keeps working untouched and keeps being right. Only the per-category rollup learns about items, in one place. If items were flagged `Transaction` rows, every one of those sites would have to opt *out*, and a missed site would silently inflate totals.

### The rollup

Pure function `rollUpByCategory(rows, items)` in `api/src/cash/category-rollup.ts`:

```
for each spending row (amount < 0):
    weight(row.category ?? 'other') += |amount| − Σ items of row   (withdrawals; clamped at 0)
                                     = |amount|                      (everything else)
for each item whose withdrawal is among the rows:
    weight(item.category) += item.amount
```

The output is the totals rounded to cents, with zeros dropped, sorted by total descending and then by name. The formula works whatever category a withdrawal is in: `cash` for new ones, anything for old ones or recategorized ones.

`CategorySpendService.byCategory(from, to)` (in `api/src/cash/`) loads the rows and items and calls the function:
- **Rows:** `{ userId, timestamp: {$gte: from, $lt: to}, amount: {$lt: 0}, ...SPENDING_ONLY }`, selecting `amount category isWithdrawal`.
- **Items:** `{ userId, withdrawalId: {$in: <ids of withdrawal rows>} }`. The second query is skipped when there are none.

Because items are joined only to live spending rows, a deleted withdrawal's items drop out of every total.

---

## Schema

### New `CashAllocation` (`api/src/shared/schemas/cash-allocation.schema.ts`, api only)

| Field | Notes |
|---|---|
| `userId` | number |
| `withdrawalId` | string: the parent `Transaction._id` |
| `category` | validated at write time |
| `amount` | a **positive magnitude**, unlike `Transaction.amount`, which stores expenses as negative numbers |
| `description` | optional, ≤ 60 characters |
| `createdAt` | `default: Date.now` |

Index: `{ userId: 1, withdrawalId: 1 }`.

### `Transaction` gains `allocatedCash?: number`

- It is the sum of the withdrawal's items, maintained **only** by the guarded writes below. Absent means 0.
- It is a reservation counter that serves the over-allocation guard, the list's "not itemized" figure and the filter.
- The rollup and the itemize panel read the items themselves, so the counter never decides a total.

### `cash` joins the built-ins

It is added to the api's `Category` enum and so becomes reserved through `BUILT_IN_NAMES`. It also goes into:
- `categories.service.ts`'s `BUILT_IN` list as `{ name: 'cash', color: '#84cc16', emoji: '💵' }`;
- the web `CategoryService` as `cash: { color: '#84cc16', icon: 'local_atm' }`.

`cash` is valid wherever a category is (transactions, recurring rules, budgets: "cap unitemized cash"), **except as an item's category**, since it is what's left over.

---

## Rules

1. **Only a live spending withdrawal takes items.** That means `isWithdrawal: true`, `amount < 0`, not deleted, and not an `internal`/`unresolved` transfer. Anything else gets a 400: "Only a cash withdrawal can be itemized". A missing row gets a 404.
2. **`amount`:** a finite number > 0, rounded to cents, ≤ 1e12.
3. **`category`:** must pass `CategoriesService.assertValid`, and is not `cash`. The message for `cash`: "Cash is what's left unitemized — pick where it went".
4. **`description`:** optional. It must be a string; it is trimmed and must be ≤ 60 characters after trimming. Empty means absent.
5. **Items can never exceed the withdrawal.** The rejection is a 400 that names what's left: "Only $500.00 is left to itemize".
6. **Deleting an item returns its amount** to what's left.
7. **Editing a withdrawal's amount** below what's already itemized is a 400: "$4,500.00 of this withdrawal is itemized — remove items first". The check is part of the guarded write, so a concurrent add can't slip under it.
8. **Items never touch `Balance` or `BalanceHistory`.** `CashModule` does not import `LedgerModule`, and a test pins that.
9. **Recategorizing a withdrawal is allowed.** Its remainder follows its category.

### Writes, in order (each one fails safe)

**Add an item:**
1. Reserve with one guarded write:
   ```ts
   findOneAndUpdate(
     { _id, userId, isWithdrawal: true, amount: { $lt: 0 }, ...SPENDING_ONLY,
       $expr: { $lte: [ { $add: [ { $ifNull: ['$allocatedCash', 0] }, amount ] },
                        { $add: [ { $abs: '$amount' }, 0.005 ] } ] } },
     { $inc: { allocatedCash: amount } },
     { new: true },
   )
   ```
   The half-cent tolerance absorbs floating-point drift from `$inc`.
2. On a miss, one read tells apart 404, "not a withdrawal" and "only $X left".
3. Create the `CashAllocation`. If that fails, release the reservation with `$inc: -amount` and rethrow; a failed release is logged.
4. A crash between steps 1 and 3 leaves the counter too high. That blocks some itemizing but never allows over-itemizing.

**Delete an item:**
1. `findOneAndDelete({ _id, userId })`, or 404.
2. Then `$inc: { allocatedCash: -amount }` on its withdrawal. If that fails it is logged, and the counter is too high: fail-safe.

---

## API

`api/src/cash/` (`CashModule`, class-level `JwtAuthGuard`, pinned in a test):

| Endpoint | Response |
|---|---|
| `GET /cash/withdrawals/:id` | `200 { id, name, timestamp, amount, allocated, remaining, items: [{ id, category, description, amount }] }`. `amount` is positive; `allocated` and `remaining` are computed from the items, oldest first. 404 unless it is a live withdrawal of the user. |
| `POST /cash/withdrawals/:id/allocations` | body `{ category, amount, description? }` → `201 { id }` |
| `DELETE /cash/allocations/:id` | `204` |

`GET /transactions`:
- **Items** gain `isWithdrawal` and `allocatedCash`.
- **New filter `unitemized=true`:** `isWithdrawal: true`, `amount < 0`, and `$expr: |amount| > (allocatedCash ?? 0) + 0.005`. It combines with the existing filters.

The first version's `GET /cash/withdrawals` list is replaced by that filter and the per-withdrawal endpoint, which fit the page's paging.

---

## The five per-category views

Each one calls `CategorySpendService.byCategory` instead of grouping `Transaction` rows itself:

1. `BudgetService.get`: each budget's `spent`.
2. `StatisticsService.byCategory`, which also feeds the monthly email and the Statistics page.
3. `ReportDataService.weekly`: the top five categories. `spent`, income and the largest expenses are unchanged, since the total is unchanged.
4. `CompareService.buildPeriodSummary`: the top three categories.
5. `TipsService.buildSpendingContext`: each month's category lines.

`CashModule` exports `CategorySpendService`; the five modules import `CashModule`. `CashModule` imports `CategoriesModule` (for `assertValid`) and nothing that imports it back.

---

## Categories page tie-in

- `Usage` gains `cashItems`. `usage()` counts items per category with the same `$group` shape, and in-use checks include them.
- `migrate(from, to)` moves items with `updateMany`, between the transactions step and the recurring step.
- `CategoriesModule` registers the `CashAllocation` model itself, so it does not import `CashModule`.
- On the web, `CategoryUsage` gains `cashItems`, and the usage text says "3 cash items" or "1 cash item".

## Ingestion

- A parsed withdrawal (`isWithdrawal && direction === 'expense'`) is booked as `category: 'cash'`, `categoryNeedsReview: false`, without calling the categorizer. That also saves a Mistral call.
- The categorizer's `cajero autom…` rule maps to `cash`.
- Existing rows are not touched.

---

## Web (Transactions page)

- **Filter.** An "Unitemized cash" toggle beside Needs Review (`aria-pressed`) sends `unitemized=true`.
- **Withdrawal rows.** A live withdrawal row shows "$500.00 not itemized" under its amount while `allocatedCash` is short of it, plus an **Itemize** action (`aria-expanded`, `aria-controls`) that opens the row's panel. Only one panel is open at a time.
- **The panel**, a full-width block under the row, has:
  - "Remaining $500.00 of $5,000.00" in an `aria-live="polite"` line;
  - the items, each with its category pill, description and amount, and a remove button labelled "Remove {category} {amount}";
  - an add form:
    - a category select built from `CategoryService.all` without `cash`;
    - an amount field (`step="0.01"`);
    - a description field (`maxlength="60"`, placeholder "What was it? (optional)").

    **Add** is disabled until a category is chosen and the amount is > 0 and ≤ remaining, and while saving.
- **After an add or remove:** reload the panel, set the row's `allocatedCash` from the reply, and call `TransactionEventsService.notify()` so the Dashboard, Budget and Statistics refresh. Focus returns to the category select after an add, and to the next item's remove button (else the select) after a remove.
- **Errors** appear inline under the form with `role="alert"`. A generation counter per panel drops stale replies.
- **Styling** uses the shared `_form-controls.scss` classes and theme tokens only. At phone width the form fields stack and nothing scrolls horizontally.

---

## Testing

Written first; each must fail before its implementation exists.

**`rollUpByCategory`** (pure)
- The worked example: $5,000 → food 3,000 + transport 1,500 gives `cash` 500.
- A withdrawal with no items contributes its full amount to its category.
- A fully itemized withdrawal contributes no `cash` row.
- An old withdrawal in `other` keeps its remainder in `other`.
- Items whose withdrawal isn't among the rows are ignored.
- The category totals add up to the total spending.
- Rounding to cents, and the sort order.

**`CategorySpendService`**
- The exact row filter.
- The item query uses only the withdrawal ids, and is skipped when there are none.

**`CashService`**
- The reservation's exact filter and update.
- Over-allocation is rejected with the remaining amount in the message.
- Rejected, with nothing written:
  - a non-withdrawal, a deleted row, an `internal` or `unresolved` transfer, and a missing row (404);
  - an unknown category and `cash`;
  - bad amounts and descriptions.
- A failed create releases the reservation.
- Delete removes the item, then decrements; a missing item is a 404.
- Breakdown: `allocated` and `remaining` are computed from the items; a non-withdrawal is a 404.
- `CashModule` does not import `LedgerModule`, and `CashController` has `JwtAuthGuard` at class level.

**`TransactionsService`**
- An amount edit below the itemized total is a 400, and the guarded write carries the `$expr` when a withdrawal's amount changes.
- `findAll` selects `isWithdrawal` and `allocatedCash`.
- The exact `unitemized` filter.

**Categories:** `usage()` counts cash items; `migrate` moves items in order; overview includes `cashItems`; `cash` is reserved.

**Ingestion:** a withdrawal is booked as `cash` with no review flag, and the categorizer isn't called. The `cajero` rule maps to `cash`.

**The five views:** each one's output comes from `CategorySpendService` (mocked with a known breakdown).

**Web:** `pnpm run build` is clean with zero warnings, and there are no colour literals in stylesheets.

---

## Out of scope

- Manual cash envelopes not backed by a detected withdrawal.
- Marking arbitrary expenses as cash.
- Editing an item in place: delete and re-add covers it.
- Itemization in the CSV export: the export lists transactions as booked.
- Moving existing withdrawals to `cash` (the user's choice).
- Reconciling a counter left high by a crash (recorded as a follow-up; fail-safe meanwhile).

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- The invariant, the rollup and the five views describe the same arithmetic.
- The positive-magnitude convention of items is stated in the schema and the rollup, where items and rows are read together.
- The counter is a guard only; every total reads the items.

**Ambiguity resolved:**
- "Counts toward budgets" means category weight, not total spending.
- Over-allocation is rejected, never clamped.
- Items count in the withdrawal's month.
- A deleted withdrawal's items stop counting but are kept.
- `cash` is valid everywhere except as an item's category.

**Scope:** one cohesive feature on data that already exists (`isWithdrawal` ships with ingestion). About nine tasks.
