# Merchant Memory and One-Click Review — Design Spec

**Goal:** Categorizing bank-mail spending costs the user one decision per merchant. Afterwards the merchant is filed automatically. Reviewing an AI guess takes one click.

**Context:**
- **How the categorizer decides.** It tries fixed rules first. A merchant no rule knows is sent to Mistral, and the guess is saved flagged `categoryNeedsReview`. When the AI fails, the row gets `other`, also flagged.
- **The review UI hides the guess.** The Transactions page shows an empty "Needs review…" dropdown, and the Dashboard shows the guessed category. So the user re-categorizes every charge by hand, even from merchants already decided, for example Prime Video twice in one day.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Remember choices | **Yes.** A per-merchant memory, taught by the user's category choices on bank-mail expenses. |
| Priority at ingestion | **Remembered choice**, then fixed rules, then Mistral. A remembered merchant is filed with no review and no AI call. |
| Pending rows | **Filed too.** Deciding one row files the other rows from the same merchant still waiting for review. |
| Review UI | **The guess is shown** with a one-click confirm; the dropdown starts on the guess. |
| Fixed rules / trusting AI outright | Not in this change. |

## Merchant key

`merchantKey(name)` in `api/src/merchants/merchant-key.ts`:
- lowercase;
- split on whitespace, `*` and `#`;
- drop every token that contains a digit (reference codes such as `2K3JD`, `#1234`);
- join the rest with single spaces.

So "PRIME VIDEO*2K3JD" and "prime video*9xq1" are both `prime video`. A key that comes out empty is never taught or used.

## Data

`MerchantCategory` (`api/src/shared/schemas/merchant-category.schema.ts`): `{ userId, key, category, updatedAt }`, with a unique index on `{ userId, key }`.

## Teaching (`MerchantMemoryService` in `api/src/merchants/`)

`learn(row, category)`, where `row` is the transaction as it was before the change. It teaches only when the row:
- is bank mail (`source: 'email'`);
- is an expense (`amount < 0`);
- is not an ATM withdrawal;
- is not an `internal` or `unresolved` transfer;
- has a non-empty key (from `merchant`, else `transactionName`).

When it teaches:
1. It upserts `{ userId, key }` with `$set: { category, updatedAt }`. The last choice wins.
2. It files the waiting rows. These are the other live bank-mail expenses with `categoryNeedsReview: true` that aren't withdrawals and have the same key. It reads their `merchant` and `transactionName`, filters by key in code, then runs `updateMany({ _id: { $in: ids }, categoryNeedsReview: true }, { $set: { category, categoryNeedsReview: false } })`.
3. It returns how many were filed.

Failures are logged, and `learn` returns 0. It never fails the user's change; that change is already saved.

**When it's called.** `TransactionsService.setCategory` and `update` (when `category` is given) call `learn` after their write succeeds. Both pass the pre-image, from the `findOneAndUpdate` in `setCategory` and the row loaded first in `update`.

**The api response.** `PATCH /transactions/:id/category` answers **200 `{ alsoFiled: number }`**, not 204. A missing row gives `{ alsoFiled: 0 }`, as the silent no-op it was.

`all()` returns every remembered key → category as a `Map`, for one ingestion run.

## Ingestion

- **Once per run,** `RunContext` gains `remembered: Map<string, string>`, from `all()`.
- **For each bank-mail expense that isn't a withdrawal,** it looks up `remembered.get(merchantKey(p.counterparty))`. If found, and the category is still in `ctx.allowed`, the row is `{ category, needsReview: false }` and neither the categorizer nor Mistral is called. Otherwise the categorizer runs as before.
- **Income and withdrawals** are unchanged: `other` with review, and `cash`.

## Categories page tie-in

`CategoryReferencesService.migrate(from, to)` also moves the remembered choices (`updateMany({ userId, category: from }, { $set: { category: to } })`), after the cash items. `CategoriesModule` registers the `MerchantCategory` model itself; there is no import cycle. A remembered category that was deleted without a move is simply ignored at ingestion, because it isn't in `allowed`.

## Web (Transactions page)

- **Each row waiting for review** shows:
  - the guess as a pill, "Entertainment?";
  - a **✓** button (`aria-label="Confirm Entertainment for prime video"`) that sets the category to the guess;
  - the dropdown, labelled "Category for {name}" and preselected on the guess, which still changes it.
- **After a successful set,** the row updates in place. When `alsoFiled > 0`, the list reloads in place and a polite status says "Also filed {n} other {name} {row|rows}".
- **The api call** `setTransactionCategory` returns `{ alsoFiled: number }`.

## Testing

- **`merchantKey`:** digit tokens dropped; `*` and `#` split; case; an all-digit name gives an empty key.
- **`MerchantMemoryService`:**
  - teaching: the exact upsert;
  - filing waiting rows: only the same key, live, email, expense, not a withdrawal, still pending, with the exact `updateMany`;
  - not teaching from income, a withdrawal, a transfer, a non-email row or an empty key;
  - failure gives 0 and a log;
  - `all()` builds the map.
- **Transactions:**
  - `setCategory` teaches from the pre-image and returns `{ alsoFiled }`;
  - a missing row gives 0;
  - `update` with a category teaches, and without one doesn't;
  - the route answers 200.
- **Ingestion:**
  - a remembered merchant is filed with no review and no categorizer call;
  - a remembered category no longer allowed falls back to the categorizer;
  - income and withdrawals ignore the memory;
  - the memory loads once per run.
- **Categories:** `migrate` moves remembered choices, in order.
- **Web:** a clean build and no colour literals.
