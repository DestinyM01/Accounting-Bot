# Cash Envelopes — Design Spec

**Goal:** Let an ATM withdrawal be broken down into what the cash was actually spent on, so cash spending reaches category budgets without being counted as an expense twice.

**Context:** Card spending is captured automatically from bank emails. Cash is not — a withdrawal arrives as one opaque lump and every peso of it is invisible to budgets. The user's framing: *"it doesn't add more to the expenses count but it goes directly into the amount like a detailed report of where was it spent."*

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Category weight | **Children own it, the withdrawal owns the total** | Only way cash spending stops being invisible to budgets. |
| Storage | **Separate `CashAllocation` collection** | Makes the existing aggregation sites correct by default. See below. |
| Input surface | **Web only** | Telegram now charges in the DR; the dashboard is the surface that survives. |
| Envelope source | **Detected ATM withdrawals only** | The envelope always has a real bank record behind it. No hand-asserted amounts. |
| Withdrawal category | **A dedicated `cash` category** | Removes a three-term aggregation formula. See below. |
| Bot budgets | **Updated too** | Two different answers to "what have I spent on food" would destroy trust in both. |

---

## The model

```
Transaction  (withdrawal)          RD$5,000   ← owns the TOTAL, moves the balance
  └─ CashAllocation  food          RD$3,000   ← owns CATEGORY weight only
  └─ CashAllocation  transport     RD$1,500
  └─ (unallocated remainder)       RD$  500   ← stays on the withdrawal
```

**The invariant:** a withdrawal's own category weight is `amount − sum(its allocations)`. Always.

Three properties follow from that single rule:

- **Nothing double-counts.** Children never touch the total or the balance.
- **Nothing vanishes.** Un-itemised cash stays visible under `cash`.
- **Partial itemisation just works.** No all-or-nothing, no draft state to manage.

### Why a separate collection

`buildFilter()` in `api/src/transactions/transactions.service.ts` filters on `userId`, type, category and date. Nothing excludes child records. The bot's `checkBudget` does a flat `reduce((sum, t) => sum + Math.abs(t.amount), 0)`. Roughly 25 such call sites exist across both services.

| | Allocations as flagged `Transaction` rows | Separate collection |
|---|---|---|
| Existing aggregation sites | **Wrong by default** — each must opt *out* | **Correct by default** — they query `Transaction` and never see cash |
| Cost of missing one | Silently inflated totals | Cash missing from one view |
| Failure direction | Fail-dangerous | Fail-safe |

Opting in at four places beats opting out at twenty-five, and the failure mode when we get it wrong is visible rather than silent.

### Why a `cash` category

If withdrawals kept an ordinary category, category spend would need three terms — the category's own transactions, *minus* allocations delegated away from withdrawals in that category, *plus* allocations delegated into it.

Giving withdrawals a dedicated `cash` category removes the middle term entirely:

```
spend(C)     =  Σ |tx.amount| where tx.category == C
             +  Σ alloc.amount where alloc.category == C          (for C ≠ cash)

spend(cash)  =  Σ (withdrawal.amount − Σ its allocations)
```

`cash` then reads as *"money withdrawn and never accounted for"* — useful on its own.

`cash` is added to the `Category` enum in **both** services, matching how ingestion fields were mirrored.

---

## Schema

New `CashAllocation`, defined in `api/src/shared/schemas/cash-allocation.schema.ts` and mirrored in `repo/` because the bot's budget service reads it:

| Field | Notes |
|---|---|
| `userId` | indexed |
| `withdrawalId` | the parent `Transaction._id`, indexed |
| `description` | free text, what the cash went on |
| `amount` | **positive magnitude**, unlike `Transaction.amount` which stores expenses negative |
| `category` | validated against built-ins + active custom categories |

The sign convention deliberately differs from `Transaction` and must be stated wherever the two are read together.

---

## Rules

1. Allocations for a withdrawal **may never exceed** the withdrawal amount. Rejected with the remaining amount in the error message.
2. Only transactions with `isWithdrawal === true` accept allocations.
3. `amount` must be greater than zero.
4. `category` validated against the same allow-list ingestion uses (built-ins plus active custom categories).
5. Deleting an allocation returns its amount to the remainder.
6. **Allocations never touch `Balance` or `BalanceHistory`.** The withdrawal already did.

---

## API

New `api/src/cash/` module:

| Endpoint | Purpose |
|---|---|
| `GET /api/cash/withdrawals` | Withdrawals with their allocations and computed remaining |
| `POST /api/cash/withdrawals/:id/allocations` | Add one |
| `DELETE /api/cash/allocations/:id` | Remove one |

This is the API's first real write surface beyond `PATCH /:id/category`, so the auth guard must be explicitly applied and tested rather than assumed to be inherited.

---

## Web

The transactions page already carries the needs-review filter and inline category assignment. It gains:

- An expandable itemisation panel on withdrawal rows, reusing `CategoryService` for the picker so built-in and custom categories stay consistent with everywhere else
- A running remaining figure that updates as allocations are added
- A filter for withdrawals with unallocated cash

---

## Aggregation opt-in sites

Four places learn about allocations. Everywhere else stays untouched and stays correct:

1. `api/` budget endpoint
2. `api/` analytics / statistics by category
3. `repo/src/service/budget.service.ts` — `checkBudget`, which also drives the cron budget alerts
4. The `cash` remainder computation shared by 1 and 2

**Known duplication:** `api/` and `repo/` are separate packages, so the rollup logic is written twice. The formula above is the contract, and both implementations are tested against the same worked example (RD$5,000 → 3,000 food + 1,500 transport + 500 remainder). A shared package is a larger refactor than this feature justifies; the risk is accepted and recorded here so drift is recognisable when it happens.

---

## Testing

- Over-allocation rejected, with the remaining amount reported
- Remainder correct after add, after delete, and after a full allocation
- Allocations leave `Balance` and `BalanceHistory` untouched — asserted explicitly
- Category rollup matches the worked example in **both** services
- A withdrawal with no allocations contributes its full amount to `cash`
- Allocation against a non-withdrawal transaction is rejected
- Allocation with an unknown category is rejected

---

## Out of scope

- Manual cash envelopes not backed by a detected withdrawal
- Marking arbitrary expenses as cash
- Editing an allocation in place — delete and re-add covers it

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:** the invariant, the `cash` formula and the four opt-in sites all describe the same arithmetic. The positive-magnitude convention is stated once in the schema and once in the rules, and does not contradict `Transaction`'s negative-expense convention because the two are never summed in the same expression.

**Ambiguity resolved:** "counts toward budgets" is defined as category weight specifically, not expense total — the withdrawal keeps the total. Over-allocation is a hard rejection rather than a clamp.

**Scope:** one cohesive feature. Depends on nothing in email ingestion v2 beyond `isWithdrawal`, which already ships.
