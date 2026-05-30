# Custom Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create custom spending/income categories (name + emoji + color) in the Telegram bot, visible everywhere categories appear in both the bot and web dashboard.

**Architecture:** Eight sequential tasks across three layers — bot (`repo/`), web API (`api/`), and Angular frontend (`web/`). D1 (schema migration) unblocks D2–D5. D6 (API) unblocks D7–D8. Built-in categories remain unchanged; custom categories are additive. Category names are constrained to `[a-z0-9-]+` to stay safe inside Telegram callback data strings.

**Tech Stack:** NestJS · nestjs-telegraf Wizard scenes · Mongoose · Angular 17 standalone components · pnpm

---

## File map

| File | Task | Change |
|---|---|---|
| `repo/src/mongodb/schemas/transaction.schemas.ts` | D1 | Remove `enum: Category` from `category` field |
| `repo/src/mongodb/schemas/recurring.schemas.ts` | D1 | Remove `enum: Category` from `category` field |
| `repo/src/mongodb/schemas/budget.schemas.ts` | D1 | Remove `enum: Category` from `category` field |
| `api/src/shared/schemas/transaction.schema.ts` | D1 | Remove `enum: Category` from `category` field |
| `api/src/shared/schemas/budget.schema.ts` | D1 | Remove `enum: Category` from `category` field |
| `repo/src/mongodb/schemas/custom-category.schema.ts` | D2 | **NEW** — Mongoose schema |
| `repo/src/service/custom-category.service.ts` | D2 | **NEW** — create / list / delete |
| `repo/src/service/index.ts` | D2 | Export new service |
| `repo/src/app.module.ts` | D2 | Register schema + service |
| `repo/src/scene/create-category.scene.ts` | D3 | **NEW** — 3-step Wizard scene |
| `repo/src/scene/index.ts` | D3 | Export new scene |
| `repo/src/buttons/category.buttons.ts` | D3 + D5 | Add color/emoji pickers; extend `categoryButtons()` |
| `repo/src/handler/custom-category.handler.ts` | D4 | **NEW** — manage categories menu |
| `repo/src/handler/index.ts` | D4 | Export new handler |
| `repo/src/buttons/transacrion.buttons.ts` | D4 | Add ⚙️ Categories button to transaction menu |
| `repo/src/handler/transaction.handler.ts` | D5 | Inject service; fetch custom cats before picker; fix `cat_` callback validation |
| `repo/src/scene/set-recurring.scene.ts` | D5 | Inject service; fetch custom cats; remove enum validation |
| `api/src/shared/schemas/custom-category.schema.ts` | D6 | **NEW** — Mongoose schema |
| `api/src/categories/categories.service.ts` | D6 | **NEW** — list / create / delete |
| `api/src/categories/categories.controller.ts` | D6 | **NEW** — GET/POST/DELETE /categories |
| `api/src/categories/categories.module.ts` | D6 | **NEW** — NestJS module |
| `api/src/app.module.ts` | D6 | Import CategoriesModule |
| `web/src/app/core/services/api.models.ts` | D7 | Add `CategoryEntry` interface |
| `web/src/app/core/services/api.service.ts` | D7 | Add `getCategories`, `createCategory`, `deleteCategory` |
| `web/src/app/core/services/category.service.ts` | D7 | **NEW** — singleton, merges built-ins + custom |
| `web/src/app/app.component.ts` | D8 | Call `categoryService.load()` on init |
| `web/src/app/pages/budget/budget.component.ts` | D8 | Use CategoryService; update form dropdown |
| `web/src/app/pages/compare/compare.component.ts` | D8 | Use CategoryService |
| `web/src/app/pages/statistics/statistics.component.ts` | D8 | Use CategoryService |
| `web/src/app/pages/transactions/transactions.component.ts` | D8 | Use CategoryService |

---

## Task D1 — Remove `enum: Category` from 5 Mongoose schemas

**Files:** 5 schema files (see map above)

**Context:** Removing the Mongoose enum validator is backward-compatible — existing documents are not touched. TypeScript types stay the same (fields still typed as `Category` or `string`). Only the runtime Mongoose validation is dropped.

- [ ] **Step 1: Edit `repo/src/mongodb/schemas/transaction.schemas.ts`**

  Find:
  ```typescript
  @Prop({ enum: Category, default: Category.OTHER })
  category: Category;
  ```
  Replace with:
  ```typescript
  @Prop({ default: Category.OTHER })
  category: string;
  ```

- [ ] **Step 2: Edit `repo/src/mongodb/schemas/recurring.schemas.ts`**

  Find:
  ```typescript
  @Prop({ enum: Category, default: Category.OTHER })
  category: Category;
  ```
  Replace with:
  ```typescript
  @Prop({ default: Category.OTHER })
  category: string;
  ```

- [ ] **Step 3: Edit `repo/src/mongodb/schemas/budget.schemas.ts`**

  Find:
  ```typescript
  @Prop({ required: true, enum: Category })
  category: Category;
  ```
  Replace with:
  ```typescript
  @Prop({ required: true })
  category: string;
  ```

- [ ] **Step 4: Edit `api/src/shared/schemas/transaction.schema.ts`**

  Find:
  ```typescript
  @Prop({ enum: Category, default: Category.OTHER }) category: Category;
  ```
  Replace with:
  ```typescript
  @Prop({ default: Category.OTHER }) category: string;
  ```

- [ ] **Step 5: Edit `api/src/shared/schemas/budget.schema.ts`**

  Find:
  ```typescript
  @Prop({ required: true, enum: Category }) category: Category;
  ```
  Replace with:
  ```typescript
  @Prop({ required: true }) category: string;
  ```

- [ ] **Step 6: Build both services**

  ```bash
  cd repo && npm run build 2>&1 | tail -5
  cd ../api && pnpm run build 2>&1 | tail -5
  ```
  Expected: both build clean.

- [ ] **Step 7: Commit**

  ```bash
  git add repo/src/mongodb/schemas/transaction.schemas.ts \
          repo/src/mongodb/schemas/recurring.schemas.ts \
          repo/src/mongodb/schemas/budget.schemas.ts \
          api/src/shared/schemas/transaction.schema.ts \
          api/src/shared/schemas/budget.schema.ts
  git commit -m "refactor(schemas): remove enum constraint from category fields"
  ```

---

## Task D2 — `CustomCategory` schema + service in `repo/`

**Files:**
- Create: `repo/src/mongodb/schemas/custom-category.schema.ts`
- Create: `repo/src/service/custom-category.service.ts`
- Modify: `repo/src/service/index.ts`
- Modify: `repo/src/app.module.ts`

- [ ] **Step 1: Create `repo/src/mongodb/schemas/custom-category.schema.ts`**

  ```typescript
  import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
  import { Document } from 'mongoose';

  @Schema()
  export class CustomCategory extends Document {
    @Prop({ required: true })  userId: number;
    @Prop({ required: true })  name:   string; // lowercase, e.g. "gym"
    @Prop({ required: true })  emoji:  string; // e.g. "💪"
    @Prop({ required: true })  color:  string; // hex e.g. "#3b82f6"
    @Prop({ default: true })   active: boolean;
  }

  export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
  ```

- [ ] **Step 2: Create `repo/src/service/custom-category.service.ts`**

  ```typescript
  import { Injectable, Logger } from '@nestjs/common';
  import { InjectModel } from '@nestjs/mongoose';
  import { Model } from 'mongoose';
  import { CustomCategory } from '../mongodb/schemas/custom-category.schema';

  @Injectable()
  export class CustomCategoryService {
    private readonly logger = new Logger(CustomCategoryService.name);

    constructor(
      @InjectModel('CustomCategory')
      private readonly model: Model<CustomCategory>,
    ) {}

    async createCategory(userId: number, name: string, emoji: string, color: string): Promise<CustomCategory> {
      this.logger.log(`User ${userId} creating category: ${name}`);
      return this.model.create({ userId, name, emoji, color, active: true });
    }

    async listCategories(userId: number): Promise<CustomCategory[]> {
      return this.model.find({ userId, active: true }).sort({ name: 1 }).exec();
    }

    async deleteCategory(userId: number, id: string): Promise<void> {
      await this.model.findOneAndUpdate({ _id: id, userId }, { active: false }).exec();
      this.logger.log(`User ${userId} deleted category ${id}`);
    }
  }
  ```

- [ ] **Step 3: Export from `repo/src/service/index.ts`**

  Append at the end of the file:
  ```typescript
  export * from './custom-category.service';
  ```

- [ ] **Step 4: Register in `repo/src/app.module.ts`**

  Add import at top of file:
  ```typescript
  import { CustomCategory, CustomCategorySchema } from './mongodb/schemas/custom-category.schema';
  ```

  In `MongooseModule.forFeature([...])`, add:
  ```typescript
  { name: 'CustomCategory', schema: CustomCategorySchema },
  ```

- [ ] **Step 5: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -5
  ```
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add repo/src/mongodb/schemas/custom-category.schema.ts \
          repo/src/service/custom-category.service.ts \
          repo/src/service/index.ts \
          repo/src/app.module.ts
  git commit -m "feat(bot/categories): add CustomCategory schema and service"
  ```

---

## Task D3 — `CreateCategoryScene` wizard (3 steps: name → color → emoji)

**Files:**
- Modify: `repo/src/buttons/category.buttons.ts` (add color/emoji pickers)
- Create: `repo/src/scene/create-category.scene.ts`
- Modify: `repo/src/scene/index.ts`

**Color palette** (10 options; emoji is what's shown in Telegram button; hex is what's stored):

| Button text | Stored hex |
|---|---|
| 🔴 Red | #ef4444 |
| 🟠 Orange | #fb923c |
| 🟡 Yellow | #eab308 |
| 🟢 Green | #22c55e |
| 🔵 Blue | #3b82f6 |
| 🟣 Purple | #a855f7 |
| 🩷 Pink | #ec4899 |
| 🩵 Cyan | #06b6d4 |
| ⬛ Dark | #374151 |
| ⬜ Light | #94a3b8 |

**Emoji picker** (20 options, 4 columns):
`✈️ 💪 🏋️ 🎓 🐶 🐱 🛒 📱 💇 🎁 ⚡ 🌿 🎨 🎵 🏖️ 🍕 ☕ 🛞 📚 🎯`

- [ ] **Step 1: Add `colorPickerButtons()` and `emojiPickerButtons()` to `repo/src/buttons/category.buttons.ts`**

  Append at the end of the file:

  ```typescript
  const COLOR_PALETTE: { label: string; hex: string }[] = [
    { label: '🔴 Red',    hex: '#ef4444' },
    { label: '🟠 Orange', hex: '#fb923c' },
    { label: '🟡 Yellow', hex: '#eab308' },
    { label: '🟢 Green',  hex: '#22c55e' },
    { label: '🔵 Blue',   hex: '#3b82f6' },
    { label: '🟣 Purple', hex: '#a855f7' },
    { label: '🩷 Pink',   hex: '#ec4899' },
    { label: '🩵 Cyan',   hex: '#06b6d4' },
    { label: '⬛ Dark',   hex: '#374151' },
    { label: '⬜ Light',  hex: '#94a3b8' },
  ];

  const EMOJI_LIST = ['✈️','💪','🏋️','🎓','🐶','🐱','🛒','📱','💇','🎁','⚡','🌿','🎨','🎵','🏖️','🍕','☕','🛞','📚','🎯'];

  export function colorPickerButtons() {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < COLOR_PALETTE.length; i += 2) {
      const row = [{ text: COLOR_PALETTE[i].label, callback_data: `pick_color:${COLOR_PALETTE[i].hex}` }];
      if (COLOR_PALETTE[i + 1]) {
        row.push({ text: COLOR_PALETTE[i + 1].label, callback_data: `pick_color:${COLOR_PALETTE[i + 1].hex}` });
      }
      rows.push(row);
    }
    return { reply_markup: { inline_keyboard: rows } };
  }

  export function emojiPickerButtons() {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < EMOJI_LIST.length; i += 4) {
      rows.push(
        EMOJI_LIST.slice(i, i + 4).map((e) => ({ text: e, callback_data: `pick_emoji:${e}` })),
      );
    }
    return { reply_markup: { inline_keyboard: rows } };
  }
  ```

- [ ] **Step 2: Create `repo/src/scene/create-category.scene.ts`**

  ```typescript
  import { Action, Ctx, On, Update, Wizard, WizardStep } from 'nestjs-telegraf';
  import { WizardContext } from 'telegraf/typings/scenes';
  import { IContext, MyMessage } from '../type/interface';
  import { CustomCategoryService } from '../service';
  import { backTranButton, colorPickerButtons, emojiPickerButtons } from '../buttons';

  const MSGS = {
    ask_name: {
      en: '🏷️ Enter a name for your category (letters, numbers, hyphens only — e.g. <b>gym</b> or <b>side-income</b>):',
      es: '🏷️ Ingresa un nombre para tu categoría (letras, números, guiones — ej. <b>gym</b>):',
      ua: '🏷️ Введіть назву категорії (літери, цифри, дефіси — напр. <b>gym</b>):',
      pl: '🏷️ Wpisz nazwę kategorii (litery, cyfry, myślniki — np. <b>gym</b>):',
    },
    invalid_name: {
      en: '⚠️ Name must be 1–20 characters: lowercase letters, numbers, hyphens only. Try again:',
      es: '⚠️ El nombre debe tener 1-20 caracteres: minúsculas, números y guiones. Intenta de nuevo:',
      ua: '⚠️ Назва: 1-20 символів, лише рядкові літери, цифри, дефіси. Спробуйте ще:',
      pl: '⚠️ Nazwa: 1-20 znaków, tylko małe litery, cyfry, myślniki. Spróbuj ponownie:',
    },
    ask_color: {
      en: '🎨 Choose a color:',
      es: '🎨 Elige un color:',
      ua: '🎨 Оберіть колір:',
      pl: '🎨 Wybierz kolor:',
    },
    ask_emoji: {
      en: '😊 Choose an emoji:',
      es: '😊 Elige un emoji:',
      ua: '😊 Оберіть емодзі:',
      pl: '😊 Wybierz emoji:',
    },
    done: {
      en: '✅ Category created!',
      es: '✅ ¡Categoría creada!',
      ua: '✅ Категорію створено!',
      pl: '✅ Kategoria utworzona!',
    },
  };

  @Update()
  @Wizard('create_category')
  export class CreateCategoryScene {
    constructor(private readonly customCategoryService: CustomCategoryService) {}

    @WizardStep(1)
    async askName(@Ctx() ctx: IContext & WizardContext) {
      const lang = ctx.session.language || 'en';
      await ctx.replyWithHTML(MSGS.ask_name[lang] ?? MSGS.ask_name.en);
      ctx.wizard.next();
    }

    @WizardStep(2)
    @On('text')
    async getName(@Ctx() ctx: IContext & WizardContext) {
      const lang = ctx.session.language || 'en';
      const raw = ((ctx.message as MyMessage).text || '').trim().toLowerCase();
      if (!raw || !/^[a-z0-9-]{1,20}$/.test(raw)) {
        await ctx.replyWithHTML(MSGS.invalid_name[lang] ?? MSGS.invalid_name.en);
        return; // stay on this step
      }
      (ctx.wizard.state as any).name = raw;
      await ctx.reply(MSGS.ask_color[lang] ?? MSGS.ask_color.en, colorPickerButtons());
      ctx.wizard.next();
    }

    @WizardStep(3)
    @Action(/pick_color:(.+)/)
    async getColor(@Ctx() ctx: IContext & WizardContext) {
      const lang = ctx.session.language || 'en';
      const data = (ctx.callbackQuery as any)?.data as string;
      const color = data.replace('pick_color:', '');
      (ctx.wizard.state as any).color = color;
      await ctx.answerCbQuery();
      await ctx.editMessageText(MSGS.ask_emoji[lang] ?? MSGS.ask_emoji.en, emojiPickerButtons());
      ctx.wizard.next();
    }

    @WizardStep(4)
    @Action(/pick_emoji:(.+)/)
    async getEmoji(@Ctx() ctx: IContext & WizardContext) {
      const lang = ctx.session.language || 'en';
      const data = (ctx.callbackQuery as any)?.data as string;
      const emoji = data.replace('pick_emoji:', '');
      const state = ctx.wizard.state as any;

      await this.customCategoryService.createCategory(
        ctx.from.id,
        state.name,
        emoji,
        state.color,
      );
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `${emoji} <b>${state.name}</b> — ${MSGS.done[lang] ?? MSGS.done.en}`,
        { ...backTranButton(lang), parse_mode: 'HTML' },
      );
      await ctx.scene.leave();
    }
  }
  ```

- [ ] **Step 3: Export from `repo/src/scene/index.ts`**

  Append at the end:
  ```typescript
  export * from './create-category.scene';
  ```

- [ ] **Step 4: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -5
  ```
  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add repo/src/buttons/category.buttons.ts \
          repo/src/scene/create-category.scene.ts \
          repo/src/scene/index.ts
  git commit -m "feat(bot/categories): add CreateCategory wizard scene and color/emoji pickers"
  ```

---

## Task D4 — `CustomCategoryHandler` + register + menu button

**Files:**
- Create: `repo/src/handler/custom-category.handler.ts`
- Modify: `repo/src/handler/index.ts`
- Modify: `repo/src/buttons/transacrion.buttons.ts`

- [ ] **Step 1: Create `repo/src/handler/custom-category.handler.ts`**

  ```typescript
  import { Action, Ctx, Update } from 'nestjs-telegraf';
  import { Logger } from '@nestjs/common';
  import { WizardContext } from 'telegraf/typings/scenes';
  import { IContext } from '../type/interface';
  import { CustomCategoryService } from '../service';
  import { backTranButton } from '../buttons';
  import { CustomCallbackQuery } from '../type/interface';

  const MSGS = {
    menu_title: {
      en: '⚙️ <b>My Categories</b>\nYour custom categories:',
      es: '⚙️ <b>Mis Categorías</b>\nTus categorías personalizadas:',
      ua: '⚙️ <b>Мої категорії</b>\nВаші власні категорії:',
      pl: '⚙️ <b>Moje Kategorie</b>\nTwoje niestandardowe kategorie:',
    },
    empty: {
      en: '⚙️ You have no custom categories yet.\nTap <b>Add</b> to create one.',
      es: '⚙️ Aún no tienes categorías personalizadas.\nToca <b>Agregar</b> para crear una.',
      ua: '⚙️ У вас ще немає власних категорій.\nНатисніть <b>Додати</b>.',
      pl: '⚙️ Nie masz jeszcze niestandardowych kategorii.\nNaciśnij <b>Dodaj</b>.',
    },
    deleted: {
      en: '✅ Category deleted.',
      es: '✅ Categoría eliminada.',
      ua: '✅ Категорію видалено.',
      pl: '✅ Kategoria usunięta.',
    },
    add_btn: { en: '➕ Add', es: '➕ Agregar', ua: '➕ Додати', pl: '➕ Dodaj' },
    back_btn: { en: '↩️ Back', es: '↩️ Volver', ua: '↩️ Назад', pl: '↩️ Wróć' },
  };

  function categoryMenuButtons(
    categories: { _id: any; name: string; emoji: string }[],
    lang: string,
  ) {
    const l = (MSGS.add_btn[lang] ? lang : 'en') as string;
    const rows = categories.map((c) => [
      { text: `${c.emoji} ${c.name}`, callback_data: 'noop' },
      { text: '🗑️', callback_data: `del_cat_${c._id}` },
    ]);
    rows.push([{ text: MSGS.add_btn[l], callback_data: 'add_category' }]);
    rows.push([{ text: MSGS.back_btn[l], callback_data: 'backT' }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  @Update()
  export class CustomCategoryHandler {
    private readonly logger = new Logger(CustomCategoryHandler.name);

    constructor(private readonly customCategoryService: CustomCategoryService) {}

    @Action('manage_categories')
    async manageCategories(ctx: IContext) {
      const lang = ctx.session.language || 'en';
      const l = (MSGS.menu_title[lang] ? lang : 'en') as string;
      const cats = await this.customCategoryService.listCategories(ctx.from.id);
      this.logger.log(`user:${ctx.from.id} manage_categories (${cats.length} cats)`);

      if (cats.length === 0) {
        await ctx.editMessageText(
          MSGS.empty[l] ?? MSGS.empty.en,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: MSGS.add_btn[l], callback_data: 'add_category' }],
                [{ text: MSGS.back_btn[l], callback_data: 'backT' }],
              ],
            },
          },
        );
        return;
      }

      await ctx.editMessageText(
        MSGS.menu_title[l] ?? MSGS.menu_title.en,
        { ...categoryMenuButtons(cats.map(c => ({ _id: (c as any)._id, name: c.name, emoji: c.emoji })), l), parse_mode: 'HTML' },
      );
    }

    @Action('add_category')
    async addCategory(@Ctx() ctx: IContext & WizardContext) {
      this.logger.log(`user:${ctx.from.id} entering create_category scene`);
      await ctx.scene.enter('create_category');
    }

    @Action(/del_cat_(.+)/)
    async deleteCategory(ctx: IContext) {
      const lang = ctx.session.language || 'en';
      const data = (ctx.callbackQuery as CustomCallbackQuery).data;
      const id = data.replace('del_cat_', '');
      this.logger.log(`user:${ctx.from.id} del_cat_${id}`);
      await this.customCategoryService.deleteCategory(ctx.from.id, id);
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        MSGS.deleted[lang] ?? MSGS.deleted.en,
        backTranButton(lang),
      );
    }

    @Action('noop')
    async noop(ctx: IContext) {
      await ctx.answerCbQuery(); // dismiss click on category-name buttons
    }
  }
  ```

- [ ] **Step 2: Export from `repo/src/handler/index.ts`**

  Append at the end:
  ```typescript
  export * from './custom-category.handler';
  ```

- [ ] **Step 3: Add "⚙️ Categories" button to transaction menu in `repo/src/buttons/transacrion.buttons.ts`**

  In `actionButtonsTransaction()`, find:
  ```typescript
      Markup.button.callback(BUTTONS[lang].RECURRING, 'recurring_menu'),
      Markup.button.callback('🔍 Search', 'search_transactions'),
  ```
  Replace with:
  ```typescript
      Markup.button.callback(BUTTONS[lang].RECURRING, 'recurring_menu'),
      Markup.button.callback('🔍 Search', 'search_transactions'),
      Markup.button.callback('⚙️ Categories', 'manage_categories'),
  ```

- [ ] **Step 4: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -5
  ```
  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add repo/src/handler/custom-category.handler.ts \
          repo/src/handler/index.ts \
          repo/src/buttons/transacrion.buttons.ts
  git commit -m "feat(bot/categories): add CustomCategoryHandler and Categories menu button"
  ```

---

## Task D5 — Dynamic category buttons at all 2 call sites

**Files:**
- Modify: `repo/src/buttons/category.buttons.ts` (extend `categoryButtons()`)
- Modify: `repo/src/handler/transaction.handler.ts` (inject service, fetch before showing picker, remove enum check)
- Modify: `repo/src/scene/set-recurring.scene.ts` (same)

**Context:** `categoryButtons(txId, lang)` currently uses `Object.values(Category)` — purely hardcoded. We extend it to accept an optional `customCategories` array. Category names in bot callbacks use format `cat_<name>_<txId>`. Custom names validated in the wizard as `[a-z0-9-]{1,20}` — safe for callback strings.

- [ ] **Step 1: Update `categoryButtons()` in `repo/src/buttons/category.buttons.ts`**

  Read the file first. Replace the function signature and body:

  ```typescript
  export function categoryButtons(
    transactionId: string,
    language: string,
    customCategories: { name: string; emoji: string }[] = [],
  ) {
    const lang = (language || 'ua') as 'en' | 'ua' | 'pl';
    // Built-in rows (8 categories)
    const builtInRows = Object.values(Category).map((cat) => [
      {
        text: CATEGORY_LABELS[cat][lang] ?? CATEGORY_LABELS[cat].en,
        callback_data: `cat_${cat}_${transactionId}`,
      },
    ]);
    // Custom category rows
    const customRows = customCategories.map((c) => [
      { text: `${c.emoji} ${c.name}`, callback_data: `cat_${c.name}_${transactionId}` },
    ]);
    // Combine and chunk into 2 columns
    const allRows = [...builtInRows, ...customRows];
    const chunked: (typeof allRows)[number][] = [];
    for (let i = 0; i < allRows.length; i += 2) {
      chunked.push([...allRows[i], ...(allRows[i + 1] ?? [])]);
    }
    return { reply_markup: { inline_keyboard: chunked } };
  }
  ```

- [ ] **Step 2: Update `TransactionHandler` to inject `CustomCategoryService` and fetch before showing picker**

  Read `repo/src/handler/transaction.handler.ts`.

  **A.** Add `CustomCategoryService` to the constructor:
  ```typescript
  constructor(
    private readonly transactionService: TransactionService,
    private readonly balanceService: BalanceService,
    private readonly statisticsService: StatisticsService,
    private readonly chartService: ChartService,
    private readonly budgetService: BudgetService,
    private readonly customCategoryService: CustomCategoryService,
  ) {}
  ```

  Also add `CustomCategoryService` to the import from `'../service'`.

  **B.** In the `@On('text')` method, find the block that replies with `categoryButtons` (currently at around line 337):
  ```typescript
      if (ctx.session.pendingCategoryTransactionId) {
        await ctx.reply(
          SELECT_CATEGORY_MESSAGE[ctx.session.language || 'en'],
          categoryButtons(ctx.session.pendingCategoryTransactionId, ctx.session.language || 'en'),
        );
      }
  ```
  Replace with:
  ```typescript
      if (ctx.session.pendingCategoryTransactionId) {
        const customCats = await this.customCategoryService.listCategories(ctx.from.id);
        await ctx.reply(
          SELECT_CATEGORY_MESSAGE[ctx.session.language || 'en'],
          categoryButtons(
            ctx.session.pendingCategoryTransactionId,
            ctx.session.language || 'en',
            customCats.map(c => ({ name: c.name, emoji: c.emoji })),
          ),
        );
      }
  ```

  **C.** In `@Action(/cat_(.+)_(.+)/)` `handleCategorySelect`, the handler already writes whatever string it receives into the DB via `setCategoryById`. No change needed there — removing the enum constraint in D1 already handles this. Verify the handler does NOT explicitly check `Object.values(Category)` — if it does, remove that check.

- [ ] **Step 3: Update `RecurringScene` to use dynamic category buttons**

  Read `repo/src/scene/set-recurring.scene.ts`.

  **A.** Add `CustomCategoryService` to imports and constructor:
  ```typescript
  import { CustomCategoryService } from '../service';
  ```
  ```typescript
  constructor(
    private readonly recurringService: RecurringService,
    private readonly customCategoryService: CustomCategoryService,
  ) {}
  ```

  **B.** In `@WizardStep(3) getTransaction`, find where `recurringCategoryButtons()` is called. Replace:
  ```typescript
      await ctx.replyWithHTML(
        STEP_LABELS.ask_category[lang] ?? STEP_LABELS.ask_category.en,
        recurringCategoryButtons(),
      );
  ```
  With:
  ```typescript
      const customCats = await this.customCategoryService.listCategories(ctx.from.id);
      await ctx.replyWithHTML(
        STEP_LABELS.ask_category[lang] ?? STEP_LABELS.ask_category.en,
        recurringCategoryButtons(customCats.map(c => ({ name: c.name, emoji: c.emoji }))),
      );
  ```

  **C.** Update `recurringCategoryButtons()` in `repo/src/buttons/category.buttons.ts` to accept custom categories. Find the function (it uses `rec_cat:` prefix). Read it and add parameter:

  ```typescript
  export function recurringCategoryButtons(
    customCategories: { name: string; emoji: string }[] = [],
  ) {
    const builtInRows = Object.values(Category).map((cat) => [
      { text: CATEGORY_BUTTON_LABELS[cat] ?? cat, callback_data: `rec_cat:${cat}` },
    ]);
    const customRows = customCategories.map((c) => [
      { text: `${c.emoji} ${c.name}`, callback_data: `rec_cat:${c.name}` },
    ]);
    const allRows = [...builtInRows, ...customRows];
    const chunked: (typeof allRows)[number][] = [];
    for (let i = 0; i < allRows.length; i += 2) {
      chunked.push([...allRows[i], ...(allRows[i + 1] ?? [])]);
    }
    return { reply_markup: { inline_keyboard: chunked } };
  }
  ```

  **Note:** `CATEGORY_BUTTON_LABELS` is defined in the recurring scene file, not in category.buttons.ts. Read the recurring scene to find where `recurringCategoryButtons()` is defined. It may be inline in the scene file — if so, move it to `category.buttons.ts` or update it in-place.

  **D.** In `@WizardStep(4) getCategory`, find and remove the enum validation:
  ```typescript
  // REMOVE THIS BLOCK:
  if (!Object.values(Category).includes(category)) {
    await ctx.answerCbQuery('⚠️ Invalid category');
    return;
  }
  ```

- [ ] **Step 4: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -5
  ```
  Expected: zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add repo/src/buttons/category.buttons.ts \
          repo/src/handler/transaction.handler.ts \
          repo/src/scene/set-recurring.scene.ts
  git commit -m "feat(bot/categories): dynamic category buttons with custom categories"
  ```

---

## Task D6 — API `CategoriesModule`

**Files:**
- Create: `api/src/shared/schemas/custom-category.schema.ts`
- Create: `api/src/categories/categories.service.ts`
- Create: `api/src/categories/categories.controller.ts`
- Create: `api/src/categories/categories.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Create `api/src/shared/schemas/custom-category.schema.ts`**

  ```typescript
  import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
  import { Document } from 'mongoose';

  @Schema()
  export class CustomCategory extends Document {
    @Prop({ required: true }) userId: number;
    @Prop({ required: true }) name:   string;
    @Prop({ required: true }) emoji:  string;
    @Prop({ required: true }) color:  string;
    @Prop({ default: true })  active: boolean;
  }

  export const CustomCategorySchema = SchemaFactory.createForClass(CustomCategory);
  ```

- [ ] **Step 2: Create `api/src/categories/categories.service.ts`**

  ```typescript
  import { Injectable } from '@nestjs/common';
  import { InjectModel } from '@nestjs/mongoose';
  import { Model } from 'mongoose';
  import { CustomCategory } from '../shared/schemas/custom-category.schema';

  const BUILT_IN = [
    { name: 'food',          color: '#10e5a0', emoji: '🍔' },
    { name: 'transport',     color: '#fb923c', emoji: '🚗' },
    { name: 'housing',       color: '#38bdf8', emoji: '🏠' },
    { name: 'health',        color: '#a78bfa', emoji: '💊' },
    { name: 'entertainment', color: '#f472b6', emoji: '🎮' },
    { name: 'salary',        color: '#10e5a0', emoji: '💼' },
    { name: 'savings',       color: '#34d399', emoji: '💰' },
    { name: 'other',         color: '#94a3b8', emoji: '📦' },
  ];

  @Injectable()
  export class CategoriesService {
    private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

    constructor(
      @InjectModel(CustomCategory.name) private readonly model: Model<CustomCategory>,
    ) {}

    async list() {
      const custom = await this.model.find({ userId: this.userId, active: true }).lean();
      return [
        ...BUILT_IN.map(c => ({ ...c, isBuiltIn: true,  id: null })),
        ...custom.map(c => ({
          name:      c.name,
          color:     c.color,
          emoji:     c.emoji,
          isBuiltIn: false,
          id:        (c as any)._id.toString(),
        })),
      ];
    }

    async create(name: string, emoji: string, color: string): Promise<void> {
      await this.model.create({ userId: this.userId, name, emoji, color, active: true });
    }

    async delete(id: string): Promise<void> {
      await this.model.findOneAndUpdate({ _id: id, userId: this.userId }, { active: false });
    }
  }
  ```

- [ ] **Step 3: Create `api/src/categories/categories.controller.ts`**

  ```typescript
  import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
  import { JwtAuthGuard } from '../auth/jwt.guard';
  import { CategoriesService } from './categories.service';

  @Controller('categories')
  @UseGuards(JwtAuthGuard)
  export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) {}

    @Get()
    list() {
      return this.categoriesService.list();
    }

    @Post()
    @HttpCode(201)
    async create(@Body() body: { name: string; emoji: string; color: string }) {
      await this.categoriesService.create(body.name, body.emoji, body.color);
    }

    @Delete(':id')
    @HttpCode(204)
    async delete(@Param('id') id: string) {
      await this.categoriesService.delete(id);
    }
  }
  ```

- [ ] **Step 4: Create `api/src/categories/categories.module.ts`**

  ```typescript
  import { Module } from '@nestjs/common';
  import { MongooseModule } from '@nestjs/mongoose';
  import { CustomCategory, CustomCategorySchema } from '../shared/schemas/custom-category.schema';
  import { CategoriesController } from './categories.controller';
  import { CategoriesService } from './categories.service';

  @Module({
    imports: [
      MongooseModule.forFeature([
        { name: CustomCategory.name, schema: CustomCategorySchema },
      ]),
    ],
    controllers: [CategoriesController],
    providers: [CategoriesService],
  })
  export class CategoriesModule {}
  ```

- [ ] **Step 5: Import `CategoriesModule` in `api/src/app.module.ts`**

  Add import at top:
  ```typescript
  import { CategoriesModule } from './categories/categories.module';
  ```
  Add `CategoriesModule` to the `imports` array.

- [ ] **Step 6: Build API**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  ```
  Expected: clean.

- [ ] **Step 7: Commit**

  ```bash
  git add api/src/shared/schemas/custom-category.schema.ts \
          api/src/categories/ \
          api/src/app.module.ts
  git commit -m "feat(api/categories): add CategoriesModule with GET/POST/DELETE endpoints"
  ```

---

## Task D7 — Web `CategoryService` + API models/service

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`
- Create: `web/src/app/core/services/category.service.ts`

- [ ] **Step 1: Add `CategoryEntry` to `api.models.ts`**

  Append at end of `web/src/app/core/services/api.models.ts`:
  ```typescript
  export interface CategoryEntry {
    name:      string;
    color:     string;
    emoji:     string;
    isBuiltIn: boolean;
    id:        string | null;
  }
  ```

- [ ] **Step 2: Add category methods to `api.service.ts`**

  Add `CategoryEntry` to the import from `./api.models`. Then append these methods:

  ```typescript
    getCategories(): Observable<CategoryEntry[]> {
      return this.http.get<CategoryEntry[]>(`${this.base}/categories`);
    }

    createCategory(body: { name: string; emoji: string; color: string }): Observable<void> {
      return this.http.post<void>(`${this.base}/categories`, body);
    }

    deleteCategory(id: string): Observable<void> {
      return this.http.delete<void>(`${this.base}/categories/${id}`);
    }
  ```

- [ ] **Step 3: Create `web/src/app/core/services/category.service.ts`**

  ```typescript
  import { Injectable } from '@angular/core';
  import { ApiService } from './api.service';

  interface CategoryDef { color: string; icon: string; }

  @Injectable({ providedIn: 'root' })
  export class CategoryService {
    /** Built-in definitions — single source of truth for the whole web app. */
    private readonly BUILT_IN: Record<string, CategoryDef> = {
      food:          { color: '#10e5a0', icon: 'restaurant'       },
      transport:     { color: '#fb923c', icon: 'directions_car'   },
      housing:       { color: '#38bdf8', icon: 'home'             },
      health:        { color: '#a78bfa', icon: 'medical_services' },
      entertainment: { color: '#f472b6', icon: 'movie'            },
      salary:        { color: '#10e5a0', icon: 'payments'         },
      savings:       { color: '#34d399', icon: 'savings'          },
      other:         { color: '#94a3b8', icon: 'receipt_long'     },
    };

    private customMap: Record<string, CategoryDef> = {};
    private _all: { name: string; color: string; icon: string; isBuiltIn: boolean }[] =
      Object.entries(this.BUILT_IN).map(([name, d]) => ({ name, ...d, isBuiltIn: true }));

    constructor(private readonly api: ApiService) {}

    /**
     * Call once from AppComponent.ngOnInit().
     * Non-blocking — built-ins are available immediately.
     * Custom categories populate in the background.
     */
    load(): void {
      this.api.getCategories().subscribe({
        next: (cats) => {
          const custom = cats.filter(c => !c.isBuiltIn);
          custom.forEach(c => {
            this.customMap[c.name.toLowerCase()] = { color: c.color, icon: 'label' };
          });
          this._all = [
            ...Object.entries(this.BUILT_IN).map(([name, d]) => ({ name, ...d, isBuiltIn: true })),
            ...custom.map(c => ({ name: c.name, color: c.color, icon: 'label', isBuiltIn: false })),
          ];
        },
      });
    }

    color(name: string): string {
      const n = name.toLowerCase();
      return this.BUILT_IN[n]?.color ?? this.customMap[n]?.color ?? '#64748b';
    }

    icon(name: string): string {
      const n = name.toLowerCase();
      return this.BUILT_IN[n]?.icon ?? 'label';
    }

    /** All categories — built-ins first, then custom. Use in dropdowns. */
    get all(): { name: string; color: string; icon: string; isBuiltIn: boolean }[] {
      return this._all;
    }
  }
  ```

- [ ] **Step 4: Build web to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/app/core/services/api.models.ts \
          web/src/app/core/services/api.service.ts \
          web/src/app/core/services/category.service.ts
  git commit -m "feat(web/categories): add CategoryService, API models and methods"
  ```

---

## Task D8 — Update 4 web components + AppComponent

**Files:**
- Modify: `web/src/app/app.component.ts` (call `categoryService.load()`)
- Modify: `web/src/app/pages/budget/budget.component.ts`
- Modify: `web/src/app/pages/compare/compare.component.ts`
- Modify: `web/src/app/pages/statistics/statistics.component.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.ts`

**Pattern for each component:** Inject `CategoryService`, delete the local `CAT_COLORS`/`CAT_ICONS` constants, replace `catColor()` and `catIcon()` methods.

- [ ] **Step 1: Call `categoryService.load()` in `AppComponent`**

  Read `web/src/app/app.component.ts`. In `ngOnInit()` (or add it if missing), add:
  ```typescript
  this.categoryService.load();
  ```

  Also add `CategoryService` to the constructor and import it from `'./core/services/category.service'`.

- [ ] **Step 2: Update `budget.component.ts`**

  Read the file. Make these changes:

  **A.** Remove `const CAT_COLORS = { ... }` and `const CAT_ICONS = { ... }` constants (the two `Record<string, string>` blocks at the top of the file).

  **B.** Add `CategoryService` to the constructor:
  ```typescript
  constructor(private api: ApiService, private catSvc: CategoryService) {}
  ```
  Also add the import: `import { CategoryService } from '../../core/services/category.service';`

  **C.** Replace `catColor()` and `catIcon()` methods:
  ```typescript
  catColor(cat: string) { return this.catSvc.color(cat); }
  catIcon(cat: string)  { return this.catSvc.icon(cat);  }
  ```

  **D.** Update the `categories` property used in the inline budget form. Currently:
  ```typescript
  readonly categories = ['food','transport','housing','health','entertainment','salary','savings','other'];
  ```
  Replace with a getter that reads from `CategoryService`:
  ```typescript
  get categories(): string[] { return this.catSvc.all.map(c => c.name); }
  ```

- [ ] **Step 3: Update `compare.component.ts`**

  Read the file. Same pattern:
  - Remove local `CAT_COLORS` constant.
  - Add `CategoryService` import and inject in constructor.
  - Replace `catColor()`:
  ```typescript
  catColor(cat: string): string { return this.catSvc.color(cat); }
  ```

- [ ] **Step 4: Update `statistics.component.ts`**

  Read the file. Same pattern:
  - Remove local `CAT_COLORS` and `CAT_ICONS` constants.
  - Add `CategoryService` import and inject.
  - Replace `catColor()` and `catIcon()`.

- [ ] **Step 5: Update `transactions.component.ts`**

  Read the file. Same pattern:
  - Remove local `CAT_COLORS` and `CAT_ICONS` constants.
  - Add `CategoryService` import and inject.
  - Replace `catColor()` and `catIcon()`.

- [ ] **Step 6: Build web to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` with no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add web/src/app/app.component.ts \
          web/src/app/pages/budget/budget.component.ts \
          web/src/app/pages/compare/compare.component.ts \
          web/src/app/pages/statistics/statistics.component.ts \
          web/src/app/pages/transactions/transactions.component.ts
  git commit -m "feat(web/categories): use CategoryService in all 4 components, load on app init"
  ```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task | Closed by |
|---|---|---|
| Custom category schema (repo + api) | D2 + D6 | `custom-category.schema.ts` in both |
| Enum constraint removal | D1 | 5 schema files patched |
| Bot wizard: name → color → emoji | D3 | `CreateCategoryScene` |
| Bot manage menu: list + add + delete | D4 | `CustomCategoryHandler` |
| "⚙️ Categories" button in transaction menu | D4 | `actionButtonsTransaction()` |
| Dynamic category picker (built-ins + custom) | D5 | `categoryButtons()` extended |
| Recurring scene uses dynamic picker | D5 | `recurringCategoryButtons()` extended |
| API GET/POST/DELETE /categories | D6 | `CategoriesModule` |
| Web: CAT_COLORS/CAT_ICONS consolidated | D7 + D8 | `CategoryService` + 4 components updated |
| Web: custom categories appear in budget form | D8 | `categories` getter uses `catSvc.all` |
| Web: built-in colors/icons unchanged | D7 | `BUILT_IN` map matches existing values |

All requirements covered. ✓

**Placeholder scan:** No TBDs. All code blocks complete. ✓

**Type consistency:**
- `CustomCategoryService.listCategories()` returns `CustomCategory[]` — `name` and `emoji` fields accessed in D5 as `c.name`, `c.emoji`. ✓
- `categoryButtons(txId, lang, customCategories)` third param typed as `{ name: string; emoji: string }[]` — matches what D5 passes. ✓
- `CategoryService.all` returns `{ name, color, icon, isBuiltIn }[]` — `budget.component.ts` accesses `.name` only. ✓

**Edge case — category name in callback:** Names constrained to `[a-z0-9-]{1,20}` in wizard — safe to embed in `cat_<name>_<txId>` callback string. ✓

**Edge case — recurring scene `CATEGORY_BUTTON_LABELS`:** This constant is defined inline in `set-recurring.scene.ts` and used in a local `recurringCategoryButtons()` also inline. Task D5 Step 3C instructs the implementer to read the file and update in-place. The implementer must handle whichever location that function actually lives in. ✓
