# Merchants Page — Design Spec

**Goal:** You can see every merchant the app files on its own, change or forget any of them, and add one by hand. When you change a merchant, the rows a wrong memory filed follow it.

**Context:**
- **What the memory does today.** Merchant memory (`2026-09-25-merchant-memory-design.md`) remembers the category chosen for each bank merchant and files that merchant's next mail with no review.
- **The problem.** The memory can't be seen. A wrong choice keeps misfiling that merchant until a row from it happens to be changed by hand.
- **The dropdown follow-up.** The merchant-memory plan flagged the review dropdown: when a guess names a deleted category, the dropdown starts on its first option, and picking that option fires no change.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Where | **Its own page,** `/merchants`, with a "Merchants" sidebar item after Categories. |
| Changing a merchant | Rows from that merchant **still in the old category** move to the new one, and rows waiting for review are filed. Rows you filed elsewhere stay. |
| Forgetting | Removes the memory only. Booked rows stay, and the next mail goes back to the AI with review. |
| Adding by hand | **Yes,** with a live preview of the key the name produces and how many booked rows it matches. |
| Finding a merchant's rows | Computed on request, by reducing each bank-mail row's name with `merchantKey()`. No stored key on transactions, and no backfill. |

## Which rows belong to a merchant

A merchant's rows are the transactions that:
- belong to the user;
- are bank mail (`source: 'email'`);
- are expenses (`amount < 0`);
- are not ATM withdrawals;
- are not `internal` or `unresolved` transfers;
- are live (`NOT_DELETED`);
- have `merchantKey(merchant || transactionName)` equal to the merchant's key.

This is the rule `learn()` already uses to file waiting rows. `MerchantMemoryService` gets one private query for it, and every operation below uses that query.

## Usable categories

A remembered category is **usable** when it's an active category (`CategoriesService.list()`) and isn't `cash` or `other`.
- **Adding and changing** accept only a usable category. Otherwise the answer is 400.
- **`all()`** (the ingestion snapshot) now **skips entries whose category is `cash` or `other`.** Deleting a category with a move into Other also moves the memory, so an entry could hold `other`. Skipping it keeps the rule that "don't know" is never remembered.
- **Ingestion** already ignores an entry whose category is no longer active.

## Api

`MerchantMemoryService` gains the operations below. The new `MerchantsController` (`@Controller('merchants')`, `JwtAuthGuard`) exposes them. `MerchantsModule` imports `CategoriesModule`, which has no import cycle: `CategoriesModule` registers the `MerchantCategory` model itself.

| Route | Answer |
|---|---|
| `GET /merchants` | **200** `[{ id, key, category, updatedAt, rows, usable }]`, sorted by `key`. `rows` is the merchant's booked row count. |
| `GET /merchants/match?name=` | **200** `{ key, rows, remembered }`. `key` is `merchantKey(name)`; empty means the name can't identify a merchant, and then `rows` is 0 and `remembered` is null. `remembered` is the category already stored under that key, or null. A missing name is treated as empty. |
| `POST /merchants` `{ name, category }` | **201** `{ id, key, alsoFiled }`. |
| `PATCH /merchants/:id` `{ category }` | **200** `{ moved }`. |
| `DELETE /merchants/:id` | **204**, including when the merchant is already gone or the id is malformed. Rows are untouched. |

**Adding** (`add(name, category)`) checks, in this order:
1. `name` must be a string of at most 200 characters, else **400**.
2. Its key must not be empty, else **400** "That name can't identify a merchant".
3. The category must be usable, else **400**.
4. The key must not already be remembered, else **409** "Already remembered as {category}; change it in the list". A duplicate-key error from the unique index, when two adds race, is also a 409.

Then it inserts `{ userId, key, category, updatedAt: now }` and files the merchant's rows still waiting for review. This is the same filing `learn()` does, pulled into one shared private method, and `alsoFiled` counts those rows. A filing failure is logged and gives `alsoFiled: 0`, because the memory is already saved.

**Changing** (`change(id, category)`):
1. **400** if the category isn't usable.
2. It loads the entry. A missing entry or malformed id gives **404**. If the entry already holds this category, it returns `{ moved: 0 }` and writes nothing.
3. **It moves the rows first.** These are the merchant's rows whose `category` is the old one, or which have `categoryNeedsReview: true`. It runs `updateMany({ _id: { $in: ids }, ...NOT_DELETED, $or: [{ category: old }, { categoryNeedsReview: true }] }, { $set: { category, categoryNeedsReview: false } })`, and `moved` is the modified count.
4. **It updates the memory last, guarded:** `updateOne({ _id, userId, category: old }, { $set: { category, updatedAt: now } })`. If nothing matched, the answer is **409** "This merchant changed at the same time; reload and try again".

If the call fails between steps 3 and 4, retrying is safe. The moved rows are no longer in the old category, and the memory still holds it.

**Forgetting:** `deleteOne({ _id, userId })`.

## Web

**Api client.** `ApiService` gains:
- `getMerchants()`
- `matchMerchant(name)`
- `addMerchant(name, category)`
- `changeMerchant(id, category)`
- `forgetMerchant(id)`

`api.models.ts` gains:
- `RememberedMerchant { id, key, category, updatedAt, rows, usable }`
- `MerchantMatch { key, rows, remembered }`

**The Merchants page** (`web/src/app/pages/merchants/`). It gets the route `/merchants` (`authGuard`, lazy) and a sidebar item "Merchants" with the `storefront` icon, after Categories.

- **Loading.** The page loads the merchants and `getCategories()` together, and shows "Loading…" until both arrive. The category pickers offer the loaded active categories except Cash and Other. A load error is shown with the api's message.
- **Header.** "Merchants", with the line "Bank merchants the app files on its own. Change one and its rows in the old category follow." Beside it is an **Add merchant** button.
- **Add form.** It opens in place, like "New category" on the Categories page.
  - **Name.** About 300 ms after typing stops, `matchMerchant` fills a live line. Only the latest reply counts. The line reads:
    - *Matches as "uber trip" · 3 booked rows*
    - *Matches as "uber trip" · no booked rows yet*
    - *Already remembered as Food*
    - *This name can't identify a merchant*
  - **Category** picker.
  - **Save** stays off until the latest preview has a non-empty key that isn't remembered, and a category is chosen.
  - **After saving,** the list reloads. A polite status says "Added uber trip", followed by "; filed N waiting rows" when N > 0.
- **Filter box.** It narrows the list by a case-insensitive substring of the key. When nothing matches, the page shows "No merchants match "…"".
- **Each merchant row** shows:
  - **The key** as stored.
  - **The category pill.** When `usable` is false, a warning replaces it: "Not used: its category was deleted", or "Not used: {Cash|Other} isn't remembered".
  - **"N rows · learned {MMM d}"**, from `updatedAt`.
  - **Change** opens an inline category picker with Save and Cancel. After saving, the list reloads, and the status says "Moved N {key} rows to {Category}", or "Saved" when N is 0.
  - **Forget** opens an inline confirmation, "Forget {key}? New mail from it goes back to review.", with Cancel and Forget. After forgetting, the list reloads and the status says "Forgot {key}".
- **Empty state.** "Nothing remembered yet. Confirm a category on the Transactions page and the merchant shows up here."
- **Behaviour.**
  - One row is edited at a time. Every other action button is disabled while a request is in flight.
  - Errors show the api's message (the 400/409 text) inside the form or row that asked.
  - Focus moves to the picker or the Forget button when a form opens.
  - On cancel, focus returns to the button that opened the form. After saving a change, it goes to the row's Change button.
  - After a forget, it goes to the next row's Change button, else the previous row's, else Add merchant.
- **Phone width (≤ 640 px).** Each row stacks: the key and pill, then the counts, then the actions. There is no horizontal scroll.
- **Styling.** Theme tokens only; no colour literals.

**The Transactions review fix.** `CategoryService` gains `loaded`, set when the category list arrives. A guess is **deleted** when `loaded` is true and the guess isn't in `categories`. For a deleted guess:
- the pill reads "{Guess}? (deleted)";
- the ✓ is not shown, because the api refuses a deleted category;
- the dropdown's first option is a disabled, selected "Choose a category", so any real choice fires a change.

Before the list loads, nothing is flagged, so a custom guess doesn't flash as deleted.

**README.** A "Merchants page" row in the features table.

## Testing

- **`MerchantMemoryService`:**
  - **`list`:** it counts only the merchant's rows (key match, bank mail, expense, not a withdrawal, not a transfer, live). `usable` is false for a deleted category, for `cash` and for `other`. The list is sorted by key.
  - **`match`:** the key, the row count and the remembered category. An empty key gives 0 and null. A missing name is treated as empty.
  - **`add`:**
    - **400** for an over-long name, an empty key, an inactive category, `cash` and `other`;
    - **409** when the key exists, and on a duplicate-key error;
    - the exact insert;
    - waiting rows filed and counted;
    - a filing failure gives 0 and a log.
  - **`change`:**
    - **400** for an unusable category;
    - **404** for a missing entry or malformed id;
    - the same category writes nothing;
    - the exact row `updateMany`, with only rows in the old category or waiting rows moving;
    - the row move comes before the guarded memory update;
    - **409** when the guard misses.
  - **`forget`:** the exact delete, no row writes, and no error for a missing or malformed id.
  - **`all()`:** skips `cash` and `other` entries.
- **`MerchantsController`:** each route's status code (201 add, 204 forget) and argument passing.
- **Web:**
  - a clean build and no colour literals in the new stylesheet;
  - preview-harness screenshots of the list, the add form's preview states, a change, a forget, a deleted-category row and the phone layout;
  - the Transactions review cell with a deleted guess.
