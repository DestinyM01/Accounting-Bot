# Custom Categories — Design Spec

**Approach:** B — Color + emoji. Custom categories store a name, emoji (for bot), and hex color (for web). The bot wizard matches the existing emoji-first category style (🍔🚗🏠). The web uses color as the visual differentiator and a generic Material icon for custom categories.

---

## Data model

New `CustomCategory` MongoDB collection, defined independently in both `repo/` and `api/` (shared database, separate schema files — same pattern as Transaction, Budget):

```typescript
CustomCategory {
  userId:  number   // owner
  name:    string   // lowercase, trimmed — e.g. "gym"
  emoji:   string   // e.g. "💪"
  color:   string   // hex from 10-color palette — e.g. "#3b82f6"
  active:  boolean  // soft-delete; default true
}
```

Built-in categories (`food`, `transport`, `housing`, `health`, `entertainment`, `salary`, `savings`, `other`) remain as-is. Custom categories are additive.

---

## Schema migration

`Transaction.category` and `Budget.category` currently enforce `@Prop({ enum: Category })`. Removing the `enum:` constraint is backward-compatible — existing documents are unaffected, new ones accept any string.

Files to migrate (remove enum constraint only, no other changes):
- `repo/src/mongodb/schemas/transaction.schemas.ts`
- `api/src/shared/schemas/budget.schema.ts`
- `api/src/shared/schemas/transaction.schema.ts`

---

## Bot layer (`repo/`)

### New: `CustomCategoryService`

Methods:
- `createCategory(userId, name, emoji, color): Promise<CustomCategory>`
- `listCategories(userId): Promise<CustomCategory[]>`
- `deleteCategory(userId, id): Promise<void>` — soft delete (active: false)

### New: `CreateCategoryScene` (Telegraf wizard, 3 steps)

```
Step 0: Prompt "Enter a name for your category:"
        → user sends text → store in wizard state → step 1

Step 1: Show color picker (10 inline buttons):
        🔴 Red | 🟠 Orange | 🟡 Yellow | 🟢 Green | 🔵 Blue
        🟣 Purple | 🩷 Pink | 🩵 Cyan | ⬛ Dark | ⬜ Light
        → user picks color → store hex → step 2

Step 2: Show emoji picker (20 inline buttons, 4 columns):
        ✈️ 💪 🏋️ 🎓 🐶 🐱 🛒 📱 💇 🎁 ⚡ 🌿 🎨 🎵 🏖️ 🍕 ☕ 🛞 📚 🎯
        → user picks emoji → save CustomCategory → confirm → leave scene
```

Color palette (name → hex):
| Button | Hex |
|---|---|
| 🔴 | #ef4444 |
| 🟠 | #fb923c |
| 🟡 | #eab308 |
| 🟢 | #22c55e |
| 🔵 | #3b82f6 |
| 🟣 | #a855f7 |
| 🩷 | #ec4899 |
| 🩵 | #06b6d4 |
| ⬛ | #374151 |
| ⬜ | #94a3b8 |

### New: `CustomCategoryHandler`

- `@Action('manage_categories')` — shows user's custom categories with inline delete buttons + "Add" button
- `@Action('add_category')` — enters CreateCategoryScene
- `@Action(/del_cat_(.+)/)` — deletes custom category by id

### Modified: category buttons flow

`categoryButtons(transactionId, language, customCategories?)` becomes a helper that accepts a pre-fetched list of custom categories alongside the built-in enum values.

Call sites that invoke `categoryButtons` (transaction handler, recurring scene, budget handler) each need to fetch custom categories first:
```typescript
const custom = await this.customCategoryService.listCategories(ctx.from.id);
await ctx.reply(SELECT_CATEGORY_MESSAGE[lang], categoryButtons(txId, lang, custom));
```

### Modified: `cat_<category>_<txId>` callback handler

Currently validates category against the enum implicitly. With custom categories, any lowercase string is accepted — the handler simply writes whatever string the callback contains into the DB.

### Modified: transaction menu

Add "⚙️ Categories" button to `actionButtonsTransaction()`.

---

## API layer (`api/`)

New `CategoriesModule` with 3 endpoints (all JWT-guarded):

| Method | Path | Body / Params | Response |
|---|---|---|---|
| GET | `/categories` | — | `{ name, color, emoji, isBuiltIn, id? }[]` |
| POST | `/categories` | `{ name, emoji, color }` | 201 |
| DELETE | `/categories/:id` | — | 204 |

`GET /categories` merges built-in categories (hardcoded in service) with the user's custom categories from MongoDB. Built-in entries have `isBuiltIn: true` and no `id`.

---

## Web layer (`web/`)

### New: `CategoryService` (`web/src/app/core/services/category.service.ts`)

An injectable Angular service that:
1. Defines built-in categories with color + Material icon name (single source of truth, replaces 4 duplicated `CAT_COLORS`/`CAT_ICONS` constants)
2. On first call fetches `GET /api/categories` and merges custom entries
3. Exposes:
   - `color(name: string): string` — hex color
   - `icon(name: string): string` — Material icon name (custom categories → `'label'`)
   - `categories$: Observable<CategoryEntry[]>` — for populating the budget creation form dropdown

### Modified: 4 web components

Budget, compare, statistics, and transactions components drop their local `CAT_COLORS`/`CAT_ICONS` constants and inject `CategoryService`:

```typescript
// Before (4 copies of this):
const CAT_COLORS = { housing: '#38bdf8', food: '#10e5a0', ... };
catColor(cat: string) { return CAT_COLORS[cat.toLowerCase()] ?? '#64748b'; }

// After (all 4 components):
constructor(private api: ApiService, private catSvc: CategoryService) {}
catColor(cat: string) { return this.catSvc.color(cat); }
catIcon(cat: string)  { return this.catSvc.icon(cat);  }
```

### Modified: budget component form

The category dropdown in the inline form currently shows 8 hardcoded categories. It will instead use `CategoryService.categories$` so custom categories appear in the list.

### Modified: api.models.ts + api.service.ts

Add `CategoryEntry` interface and 3 API methods (`getCategories`, `createCategory`, `deleteCategory`).

---

## What does NOT change

- Built-in category enum values in bot (`food`, `transport`, etc.) — still exist, still used for built-ins
- Existing transactions with built-in or `other` categories — untouched
- The `cat_<category>_<txId>` callback format — unchanged, just accepts custom strings too
- The existing recurring, statistics, compare, analytics pages — they read category from transactions, which already store any string; they just need color/icon via `CategoryService`

---

## Spec self-review

**Placeholder scan:** No TBDs. Color palette is fully defined. Emoji list is specified. ✓

**Internal consistency:** `CategoryService` is the single definition of built-in colors — the 4 component constants are deleted not just shadowed. The budget form uses `CategoryService.categories$` so new custom categories appear there automatically. ✓

**Scope:** This is one cohesive feature (custom categories) touching 3 layers. Each layer is independently testable. Decomposition: schema migration first, then bot CRUD, then API CRUD, then web service, then 4 component updates. ✓

**Ambiguity resolved:** Custom category names are lowercased and trimmed before storage (matches built-in convention). Duplicate name prevention: if a user creates a category with the same name as a built-in, the web will show the custom color (custom entries take precedence in the merge). The bot wizard does not prevent duplicate names (YAGNI — it's one user's data). ✓
