# Web Write Surface — Design Spec (migration sub-project 1)

**Goal:** Let the web app create, edit, delete and resolve transactions, and create recurring rules — so the Telegram bot is no longer required for anything the user does day to day.

**Context:** Telegram now charges for messaging in the DR, so the bot is being retired as an input channel. Card spending arrives by email ingestion; everything else — cash, manual income, corrections, the salary recurring rule — currently has **no** web path: the API exposes `PATCH /transactions/:id/category` and nothing else that writes a transaction, and `GET`/`DELETE` but no `POST` for recurring rules.

**Migration scope (decided):** family accounts, premium and admin broadcast retire with the bot. The compound-interest calculator ports in a later sub-project. Sub-project order: **this** → balance set + history page → categories page → cash envelopes → settings.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Entry point | **Floating `+` on every page**, opening the form as an overlay | Fastest entry from any screen; matches how the bot was used. First overlay pattern in the app — designed inside `design.md`, not bolted on. |
| Delete | **Soft-delete, always** (`deletedAt`) | Hard-deleting an email-sourced row frees its `sourceMessageId`; the next poll re-creates it and re-applies the balance. Soft-delete keeps the key occupied and the trail auditable. |
| Balance on edit/delete | **Only if the row moved it** | `internal` and `unresolved` rows never touched the balance; reversing them corrupts it. The bot's delete does exactly this today. |
| `unresolved` resolution | **Server endpoint + web action, in this sub-project** | Hardening batch A made `unresolved` a real, recurring state (every unmatched incoming transfer). A state with no way out is a dead end. |
| Cross-cutting filters | **Shared constants per package**, applied everywhere | `deletedAt` adds a second filter to the same 21+ sites that hand-copied the `transferKind` one three times. The review found that pattern; this is where it stops. |
| Manual rows | `source: 'manual'` | Distinguishes them from `email` and `recurring` in every view and export. |
| Email-sourced amount edits | **Allowed, with history** | The bank stated the amount, but parse errors happen and the user must be able to correct them. History keeps it honest. |

---

## API

All new endpoints sit behind the existing JWT guard. This is the API's first real write surface, so the guard is **asserted in tests**, not assumed.

### `POST /transactions`

```ts
{ type: 'income' | 'expense'; amount: number; name: string; category: string; timestamp?: string }
```

- `amount` must be > 0; the server signs it (expense → negative) and writes `transactionType` via the `TransactionType` enum — never a literal, the values are legacy Russian strings.
- `category` validated against built-ins + active custom categories. The allow-list helper is extracted once and reused by ingestion (which currently carries its own copy).
- Writes `source: 'manual'`, moves `Balance`, writes `BalanceHistory` with reason `income`/`expense` — mirroring `repo/`'s `createTransaction` + `updateBalance`.

### `PUT /transactions/:id`

Editable: `name`, `category`, `amount`, `timestamp`. On an amount change the **net delta** is applied to the balance and a `BalanceHistory` row with reason `manual` is written — **unless** the row is `internal` or `unresolved`, in which case the amount is stored and the balance is untouched. Deleted rows cannot be edited (404).

The write is guarded: it only lands if the row is still live and still carries the `amount` and `transferKind` the delta was computed from. If a concurrent delete, edit or resolution changed any of those between read and write, the request returns **409** and nothing moves — the client reloads and retries. (Added after review; the first draft's bare `updateOne` could land an edit on a row another tab had just deleted.)

### `DELETE /transactions/:id`

Sets `deletedAt: now`. Reverses the balance and writes history `delete` **only if** the row moved the balance (not `internal`, not `unresolved`, not already deleted). Response 204. Never removes the document.

### `PATCH /transactions/:id/transfer-kind`

```ts
{ kind: 'internal' | 'external' }
```

Only valid from `unresolved` (409 otherwise). `internal` → set and done, no balance. `external` → set, apply the balance **now** exactly once by the row's sign, write history. This is the point where "record it without asserting it" becomes an assertion, on the user's say-so.

### `POST /recurring`

```ts
{ type: 'income' | 'expense'; amount: number; name: string; category: string; dayOfMonth: number }
```

`dayOfMonth` 1–28 (the schema's existing bound). Mirrors the bot's `createRecurring`. This is what lets the user create the **salary income rule** the nómina email confirms.

### Balance semantics — the whole contract in one table

| Row kind | create | edit amount | delete | resolve → external |
|---|---|---|---|---|
| ordinary / `external` | moves | net delta | reverses | n/a |
| `internal` | no | **no** | **no** | n/a |
| `unresolved` | no | **no** | **no** | **moves once** |
| already deleted | — | 404 | 404 | 404 |

---

## Schema

Add to **both** `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts`:

```ts
@Prop() deletedAt?: Date;
```

Same collection; a field in one and not the other is a bug.

---

## Shared filters — where the copy-paste stops

Per package (`api/src/shared/` and `repo/src/type/` or the schema file), export:

```ts
export const NOT_DELETED = { deletedAt: null } as const;
export const NON_SPENDING_KINDS = ['internal', 'unresolved'] as const;
export const SPENDING_ONLY = { ...NOT_DELETED, transferKind: { $nin: NON_SPENDING_KINDS } } as const;
export const isNonSpendingTransfer = (k?: string) => (NON_SPENDING_KINDS as readonly string[]).includes(k ?? '');
```

Every listing query spreads `NOT_DELETED`; every query that sums, averages, counts or groups money spreads `SPENDING_ONLY`. The 21 hand-copied `$nin` literals are replaced, and the three JS re-spellings of the predicate use the helper. `$nin` matches an absent field, so ordinary card transactions keep counting; `deletedAt: null` likewise matches documents that never had the field.

`repo/` receives the same constants and the `transferKind`/`deletedAt` guards on its own delete/edit paths. It gains **no new features** — it is retiring — but its crons still sum this collection, so they must agree with the web.

---

## Web

### Floating action button

A single global `FabComponent` rendered from `app.component`, visible on every authenticated route. Per the Hallmark component rule it ships **all eight states** (default, hover, `:focus-visible`, `:active`, disabled, loading, error, success) with styles referencing `design.md` tokens only — no inline colours. Fixed bottom-right, inside the 16px mobile gutter, never overlapping the notification bar.

### Transaction form overlay

`TransactionFormComponent`, opened by the FAB (create) and by a row's edit action (edit, prefilled). Fields: type toggle, amount, name, category (`CategoryService` — built-ins + custom, as everywhere else), date (default now). Reuses the budget-creation form's field styling. Overlay closes on save, Escape, or backdrop; focus returns to the trigger. Mobile: full-width sheet.

### Transactions page

Row actions: edit, delete (inline confirm, not a browser `confirm()`), and for `unresolved` rows two buttons — **Internal** / **Expense** — calling the resolution endpoint. Deleted rows are not listed.

### Recurring page

A small create form (type, amount, name, category, day of month) above the existing list and Sankey.

### Dashboard

The recent-transactions card tags `internal`/`unresolved` rows the same way the transactions page does (review finding: it still renders them as red expenses beneath a stat that excludes them). Dashboard auto-refresh already exists; creating from the FAB triggers it.

### Bundled review fixes (same files, same predicate)

- Categorizer: match Mistral's reply case-insensitively and return the canonical custom-category name; anchor `RULES` on word boundaries so `cine` stops matching `MEDICINE`.
- `reviewCategories` getter duplicate removed.

---

## Testing

- Sign and enum on create; category allow-list rejects unknowns.
- Balance delta on create, edit, delete — and **zero** delta on edit/delete of `internal`/`unresolved` rows.
- Soft-delete: `sourceMessageId` retained; row absent from listings, sums, CSV and dashboard; a re-poll of the same mail is a `duplicate`, not a resurrection.
- Resolution: `external` applies balance exactly once; second call is 409; `internal` moves nothing.
- Recurring create: day bound, enum type.
- JWT guard present on every new route.
- Every aggregation site uses `SPENDING_ONLY`, every listing uses `NOT_DELETED` — asserted per query, as the earlier per-site tests were.
- Web: FAB renders on every route; overlay create → dashboard refresh; resolution buttons appear only on `unresolved` rows.

---

## Out of scope

- Balance manual set and history page — sub-project 2
- Custom-categories management page — sub-project 2
- Cash envelopes — sub-project 3 (spec exists)
- Settings (language/currency), compound-interest calculator — later
- An advancing ingestion watermark (review follow-up; not a correctness risk after batch A)

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:** the balance table, the endpoint rules and the tests all say the same thing — only rows that moved the balance ever move it again, and resolution is the single path from "recorded" to "asserted". Soft-delete is the only delete, everywhere.

**Ambiguity resolved:** "edit" on an email-sourced row is allowed and logged; a deleted row is 404 to every write; `SPENDING_ONLY` includes `NOT_DELETED` so no aggregation can count a deleted row.

**Scope:** one cohesive goal — the web can write. The bot changes are confined to the shared filters and the two balance guards, both of which are corrections, not features.
