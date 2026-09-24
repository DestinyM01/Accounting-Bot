# Categories Page — Design Spec (migration sub-project 5)

**Goal:** The web can create, edit, rename and delete custom categories. A delete or rename moves everything that uses the category — transactions, recurring rules and budgets — in steps that are safe to repeat, so no data is ever left under a dead name.

**Context:**
- **The api already has** `GET/POST/DELETE /categories`, and the web has the three calls, but no page uses them.
- **Today's create validates nothing:** no trimming, no lowercasing, no duplicate check, and a custom `food` would shadow the built-in.
- **Today's delete only sets `active: false`.** Transactions keep the name (shown grey), and budgets and recurring rules keep pointing at it.
- **The bot's rules,** now retired with it: names `^[a-z0-9-]{1,20}$`, never a built-in name, a colour from a palette of 10, an emoji from a set of 20.
- **Categories are referenced by name** in `transactions.category`, `recurrings.category` and `budgets.category` (budgets keyed by category + month + year). The ingestion categorizer offers the active names to Mistral on each run.

**Migration order (revised 2026-09-24):** recurring scheduler, email reports, balance page (done) → **this** → cash envelopes → settings.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Delete of a category in use | **Move everything to a category the user picks** | User's choice. Nothing is left under a dead name. |
| How a move runs | **Ordered steps, each safe to repeat,** with a **Finish move** action for an interrupted one | MongoDB here is a single node: no multi-collection transactions. |
| Rename | The same move, from the old name to a new one; the category keeps its id | One mechanism for both. |
| Rename onto an existing category | Refused (409) | That is a merge, which delete-and-move already does. |
| Budgets that collide in a month | **Added together** | Keeps the total planned spending. |
| Budget merge order | Delete the moved budget first, then add its amount to the target | An interruption between the two under-counts (warns early) rather than double-counts (hides overspending). |
| Name rule | Lowercase letters **including accented ones**, digits and hyphens, 1–20 characters: `^[\p{Ll}0-9-]{1,20}$` (Unicode), after trim + lowercase | The bot's a–z-only rule rejected `educación` and `niños`. |
| Reserved names | The 8 built-ins, and any name still being moved away from by an unfinished move | A new category under a pending move's old name would be swept into that move. |
| Palette and emoji | The bot's 10 colours and 20 emoji, defined once in the api and returned to the web | One source; the web never hard-codes them. |
| Re-creating a deleted name | Revives the old record (new emoji/colour) instead of duplicating | No two records share a name. |
| Built-ins | Read-only | They are the stable core the rules and the categorizer rely on. |
| Emoji on the rest of the web | Out of scope | Custom categories keep their generic tag icon elsewhere. |

---

## API

All routes under the existing class-level `JwtAuthGuard` of `CategoriesController`.

### `api/src/categories/category-rules.ts` (pure)

```ts
export const BUILT_IN_NAMES: readonly string[];            // from the Category enum
export const PALETTE: readonly { label: string; hex: string }[];  // the bot's 10, in order
export const EMOJIS: readonly string[];                     // the bot's 20, in order
export const NAME_PATTERN = /^[\p{Ll}0-9-]{1,20}$/u;
export function normalizeName(raw: unknown): string;        // String(raw).trim().toLowerCase(); '' for non-strings
export function nameError(name: string): string | null;     // rule and built-in check; null when valid
export function isPaletteColor(hex: unknown): boolean;
export function isKnownEmoji(e: unknown): boolean;
```

Palette, in order: Red `#ef4444`, Orange `#fb923c`, Yellow `#eab308`, Green `#22c55e`, Blue `#3b82f6`, Purple `#a855f7`, Pink `#ec4899`, Cyan `#06b6d4`, Dark `#374151`, Light `#94a3b8`.

Emoji, in order: ✈️ 💪 🏋️ 🎓 🐶 🐱 🛒 📱 💇 🎁 ⚡ 🌿 🎨 🎵 🏖️ 🍕 ☕ 🛞 📚 🎯.

### Schema

Add to **both** `api/src/shared/schemas/custom-category.schema.ts` and `repo/src/mongodb/schemas/custom-category.schema.ts` (same collection):

```ts
/** An unfinished move of every reference from one name to another; cleared when it completes. */
@Prop({ type: Object, default: null }) pending?: { from: string; to: string } | null;
```

### Endpoints

**`GET /categories`** — unchanged: built-ins plus active custom categories, feeding every picker.

**`GET /categories/overview`** — for the page:

```ts
{
  categories: Array<{
    id: string | null;               // null for built-ins
    name: string; emoji: string; color: string; isBuiltIn: boolean;
    active: boolean;                 // false only for a deleted category whose move is unfinished
    usage: { transactions: number; recurring: number; budgets: number };
    pending: { from: string; to: string } | null;
  }>;
  palette: { label: string; hex: string }[];
  emojis: string[];
}
```

- **Rows:** built-ins first, then custom categories that are active or have `pending`, ordered by name.
- **Usage:** non-deleted transactions (`NOT_DELETED`), active recurring rules, and budgets of any month. Computed with one `$group` aggregation per collection, not one query per category.

**`POST /categories`** `{ name, emoji, color }` → `201 { id }`.
- `name` is normalized, and then:
  - `nameError` → 400;
  - an active custom category with that name → 409 *"You already have a category called {name}"*;
  - a `pending.from` equal to it → 409 *"{name} is still being moved; finish that move first"*.
- `emoji` must satisfy `isKnownEmoji`, and `color` `isPaletteColor` → otherwise 400.
- **An inactive record with that name and no `pending`** is revived: `active: true`, with the new emoji and colour. If legacy data holds several, the most recently created one (highest `_id`) is revived. Otherwise a new record is created.

**`PATCH /categories/:id`** `{ name?, emoji?, color? }` → `200 { id }`.
- **Rejected when:**
  - the id is unknown, or not the user's → 404;
  - the category is inactive or has `pending` → 409;
  - a provided field is invalid → 400. Only provided fields are validated, so a legacy off-palette colour does not block an emoji change.
- **Emoji/colour:** `$set` in place.
- **A different normalized name is a rename:**
  - The new name passes the same checks as create (400/409). Renaming onto another active category's name → 409 *"{to} already exists — delete {from} and move it there to merge"*.
  - One guarded write: `findOneAndUpdate({ _id, userId, name: from, active: true, pending: null }, { $set: { name: to, pending: { from, to } } })`. A miss → 409.
  - Then **the move** (below).

**`DELETE /categories/:id?moveTo=`** → `204`.
- **Rejected when:**
  - the id is unknown → 404;
  - the category is inactive or pending → 409.
- **In use** (any usage count > 0):
  - `moveTo` is required → 400 *"{name} is in use — choose a category to move it to"*.
  - `moveTo` must be an active category (built-in or custom) other than this one → 400.
- **The write:** one guarded `findOneAndUpdate({ _id, userId, active: true, pending: null }, { $set: { active: false, pending } })`, where `pending` is `{ from: name, to: moveTo }` when moving and `null` when not. A miss → 409. Then the move, when moving.

**`POST /categories/:id/finish`** → `200 { id }`. A record with `pending` re-runs the move; one without → 404.

### The move — `migrate(from, to)`, then clear `pending`

Each step touches only rows still under `from`, so repeating a finished step changes nothing.

1. **Transactions:** `updateMany({ userId, category: from }, { $set: { category: to } })` — deleted rows too, so nothing references a dead name.
2. **Recurring rules:** `updateMany({ userId, category: from }, { $set: { category: to } })` — inactive rules too.
3. **Budgets,** for each `{ userId, category: from }`:
   - **no target budget for that month and year:** `updateOne({ _id, category: from }, { $set: { category: to } })`;
   - **otherwise:** `findOneAndDelete({ _id, category: from })`, then `updateOne({ _id: target._id }, { $inc: { limitAmount: deleted.limitAmount } })`.
4. **Clear:** `updateOne({ _id }, { $set: { pending: null } })`.

Any failure leaves `pending` set. The page then shows **Finish move**.

**Known race, recorded, not handled:** an ingestion run that loaded its category list just before a move, and categorizes a mail with Mistral into the moved category, can write the old name once after step 1. The row shows grey and is recategorized in one click. Every other writer validates against the active list, which the first write of the move already changed.

---

## Web

### Navigation

`{ label: 'Categories', icon: 'sell', path: '/categories' }` after Recurring, with a lazy route.

### The page

1. **Header:** "Categories" and a **New category** button.
2. **New-category form** (inline):
   - a name input with a live check against the same rule (the server is authoritative);
   - the emoji as a wrapping grid of buttons with `aria-pressed`;
   - the colours as swatch buttons with `aria-pressed` and `aria-label` set to the colour's name;
   - a preview chip (emoji and name on the chosen colour);
   - **Create** and **Cancel**. Create is disabled until the name passes and an emoji and colour are chosen, and while saving.
3. **Your categories:** one row per custom category with emoji, swatch, name and usage (*"12 transactions · 1 recurring rule · 2 budgets"*, or *"Not used yet"*). Actions **Edit** and **Delete**:
   - **Edit:** the same fields prefilled. When the name changes: *"Renames it on 12 transactions, 1 rule and 2 budgets."*
   - **Delete of a category in use:** *"Move its 12 transactions, 1 rule and 2 budgets to"* a `<select>` of every other active category, then **Delete and move** — disabled until a target is chosen.
   - **Delete of an unused category:** *"Delete {name}?"* with **Delete** and **Cancel**.
   - **Pending:** *"Moving {from} to {to} didn't finish."* with **Finish move**, instead of Edit and Delete.
4. **Built-in:** read-only rows (icon, swatch, name, usage) under the note *"Built-in categories can't be changed."*

### Behaviour

- **After any successful change:**
  - reload the overview;
  - `CategoryService.load()`, so every picker in the app updates;
  - `TransactionEventsService.notify()`, so lists showing category names reload.
- **One action at a time:** only one form or row action is open, and its buttons disable while a request is in flight.
- **Responses:** each overview load is tagged, and a stale response is ignored.
- **Focus:** opening a form focuses its first field; closing it returns focus to the button that opened it.
- **Errors:** they show next to the action that caused them (`.fc-error`, `role="alert"`). The server's message is shown when present.
- **Colours:** swatch colours come from data (the overview's palette, or a category's colour) bound with `[style.background]`. The stylesheet uses `var(--…)` tokens only.
- **Phone width:** rows and pickers wrap, with no horizontal scroll.

---

## Testing

Written first; each must fail before its implementation exists.

**`category-rules`**
- `gym`, `side-income`, `educación` and `niños` are valid.
- `Gym!` normalizes to `gym!`, which is invalid; `a b`, an empty name and 21 characters are invalid.
- Every built-in name is reserved.
- Only palette colours and set emoji are accepted.

**`CategoriesService`** (models mocked)
- Create:
  - normalizes the name;
  - rejects a bad name, emoji or colour (400);
  - rejects a duplicate active name (409);
  - rejects a name under a pending move (409);
  - revives an inactive record.
- Patch:
  - an emoji or colour change is written in place;
  - it validates only the fields provided;
  - a built-in or unknown id → 404; an inactive or pending category → 409;
  - a rename runs the guarded write then the move;
  - a rename onto an active name → 409.
- Delete:
  - in use without `moveTo` → 400;
  - `moveTo` equal to itself, inactive, or unknown → 400;
  - unused → deactivates without moving;
  - a guarded-write miss → 409.
- The move:
  - transactions (deleted ones included) and recurring rules (inactive ones included) are switched by name;
  - a budget with no target is renamed;
  - a budget with a target is deleted, then its amount added;
  - `pending` is cleared last;
  - re-running it after it completes changes nothing.
- Finish: re-runs the move; 404 without `pending`.
- Overview: usage from grouped aggregations; built-ins first; custom sorted by name; unfinished deleted moves included; palette and emoji included.
- `JwtAuthGuard` on `CategoriesController`, pinned alongside the other controllers.

**Web** — `pnpm run build` clean with zero warnings; no colour literals in stylesheets.

---

## Out of scope

- Showing custom-category emoji across the rest of the web.
- Moving references to category ids.
- Reordering categories, or colours outside the palette.
- Editing or deleting built-ins.

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- One move mechanism serves delete and rename.
- The first write of every move (guarded on `pending: null`) both reserves the old name and — for deletes — hides the category.
- Names reserved by a pending move are refused by create and rename.
- The overview is the only reader that sees inactive categories, and only those with an unfinished move.

**Ambiguity resolved:**
- "In use" means non-deleted transactions, active rules, or any budget.
- The move switches deleted transactions and inactive rules too.
- Renaming onto an existing name is refused, not merged.
- Only provided fields are validated on edit.
- Revival happens only for an inactive record without `pending`.

**Scope:** one page and five endpoints over the categories collection and the three collections that name categories.
