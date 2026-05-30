# Bot: Transaction Edit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Telegram bot users edit a transaction's name or amount without deleting and re-adding it.

**Architecture:** Two sequential tasks. C1 adds the buttons and service methods (infrastructure). C2 wires them into the TransactionHandler. The edit flow uses the existing session-type pattern: `ctx.session.type = 'edit_name' | 'edit_amount'` + `ctx.session.editTransactionId`. All commands run from `repo/`.

**Tech Stack:** NestJS · nestjs-telegraf · Mongoose · TypeScript — `cd repo && npm run build` to verify.

---

## File map

| File | Task | Change |
|---|---|---|
| `repo/src/buttons/transacrion.buttons.ts` | C1 | Add edit button to menu + `editTransactionListButtons()` + `editFieldButtons()` |
| `repo/src/service/transaction.service.ts` | C1 | Add `showLastNWithEditOption()`, `getTransactionById()`, `updateTransactionName()`, `updateTransactionAmount()` |
| `repo/src/type/interface/context.interface.ts` | C1 | Add `editTransactionId?: string` to session |
| `repo/src/handler/transaction.handler.ts` | C2 | Add 5 new `@Action` handlers + 2 new text-branch cases |

---

## Task C1 — Buttons, service methods, session type

**Files:**
- Modify: `repo/src/buttons/transacrion.buttons.ts`
- Modify: `repo/src/service/transaction.service.ts`
- Modify: `repo/src/type/interface/context.interface.ts`

---

- [ ] **Step 1: Read `context.interface.ts`** to find the session interface. Add `editTransactionId?: string` to the session type.

  The file defines `IContext` with a `session` property. The session type likely has `type?: string` among other fields. Add `editTransactionId?: string` alongside it.

  Example — if the session interface currently looks like:
  ```typescript
  session: {
    type?: string;
    language?: string;
    // ...other fields
  }
  ```
  Add:
  ```typescript
  session: {
    type?: string;
    editTransactionId?: string;
    language?: string;
    // ...other fields
  }
  ```

---

- [ ] **Step 2: Add 3 new button functions to `transacrion.buttons.ts`**

  Read the file first. Then:

  **A.** In `actionButtonsTransaction()`, add `✏️ Edit` before the `🔍 Search` button:

  Replace:
  ```typescript
      Markup.button.callback(BUTTONS[lang].DELETE_LAST, 'delete_last'),
      Markup.button.callback(BUTTONS[lang].RECURRING, 'recurring_menu'),
      Markup.button.callback('🔍 Search', 'search_transactions'),
      Markup.button.callback(BUTTONS[lang].BACK, 'back'),
  ```
  With:
  ```typescript
      Markup.button.callback(BUTTONS[lang].DELETE_LAST, 'delete_last'),
      Markup.button.callback('✏️ Edit', 'edit_last'),
      Markup.button.callback(BUTTONS[lang].RECURRING, 'recurring_menu'),
      Markup.button.callback('🔍 Search', 'search_transactions'),
      Markup.button.callback(BUTTONS[lang].BACK, 'back'),
  ```

  **B.** Append two new exported functions after `backTranButton`:

  ```typescript
  /** Shows last N transactions as a list for editing — one button per transaction. */
  export function editTransactionListButtons(
    transactions: { _id: any; transactionName: string; amount: number }[],
    language: string = 'en',
  ) {
    const lang = (BUTTONS[language] ? language : 'en') as string;
    const buttons = transactions.map((t) => [
      {
        text: `${t.transactionName}: ${Math.abs(t.amount)}`,
        callback_data: `edit_select_${t._id}`,
      },
    ]);
    buttons.push([{ text: BUTTONS[lang].BACK, callback_data: 'backT' }]);
    return { reply_markup: { inline_keyboard: buttons } };
  }

  /** Shown after a transaction is selected — lets user pick which field to edit. */
  export function editFieldButtons(txId: string, language: string = 'en') {
    const lang = (BUTTONS[language] ? language : 'en') as string;
    return Markup.inlineKeyboard(
      [
        Markup.button.callback('📝 Name',   `edit_name_${txId}`),
        Markup.button.callback('💰 Amount', `edit_amount_${txId}`),
        Markup.button.callback(BUTTONS[lang].BACK, 'backT'),
      ],
      { columns: 2 },
    );
  }
  ```

---

- [ ] **Step 3: Add 4 methods to `TransactionService`**

  Read `transaction.service.ts` to understand the current structure. Append these methods before the closing `}` of the class:

  ```typescript
  /** Shows last N transactions as inline buttons for editing. */
  async showLastNTransactionsWithEditOption(ctx: IContext, count: number): Promise<void> {
    const language = ctx.session.language || 'en';
    const userId = ctx.from.id;
    try {
      const transactions = await this.transactionModel
        .find({ userId })
        .sort({ timestamp: -1 })
        .limit(count)
        .exec();

      if (transactions.length === 0) {
        await ctx.editMessageText(
          DELETE_LAST_MESSAGE2[language] ?? DELETE_LAST_MESSAGE2['en'],
          backTranButton(language),
        );
        return;
      }

      const EDIT_SELECT = {
        en: '✏️ Select a transaction to edit:',
        es: '✏️ Selecciona una transacción para editar:',
        ua: '✏️ Оберіть транзакцію для редагування:',
        pl: '✏️ Wybierz transakcję do edycji:',
      };

      await ctx.editMessageText(
        EDIT_SELECT[language] ?? EDIT_SELECT['en'],
        editTransactionListButtons(
          transactions.map((t) => ({ _id: t._id, transactionName: t.transactionName, amount: t.amount })),
          language,
        ),
      );
    } catch (error) {
      this.logger.error('Error in showLastNTransactionsWithEditOption', error);
      throw error;
    }
  }

  /** Fetches a single transaction (scoped to userId). */
  async getTransactionById(userId: number, txId: string): Promise<(typeof this.transactionModel.prototype) | null> {
    return this.transactionModel.findOne({ _id: txId, userId }).exec();
  }

  /** Updates only the name of a transaction. No balance change. */
  async updateTransactionName(userId: number, txId: string, newName: string): Promise<void> {
    await this.transactionModel.findOneAndUpdate(
      { _id: txId, userId },
      { transactionName: newName.toLowerCase().trim() },
    ).exec();
    this.logger.log(`Updated name for transaction ${txId} (user ${userId})`);
  }

  /**
   * Updates the amount of a transaction and adjusts the user's balance accordingly.
   * Reverses the old balance effect, then applies the new amount.
   */
  async updateTransactionAmount(userId: number, txId: string, newRawAmount: number): Promise<void> {
    const tx = await this.transactionModel.findOne({ _id: txId, userId }).exec();
    if (!tx) {
      this.logger.warn(`Transaction ${txId} not found for user ${userId} during amount update`);
      return;
    }
    // Reverse the old stored amount's balance effect
    await this.balanceService.reverseTransaction(userId, tx.amount, tx.transactionName, txId);

    // Stored amount carries the sign: expense → negative, income → positive
    const newStoredAmount =
      tx.transactionType === TransactionType.EXPENSE ? -Math.abs(newRawAmount) : Math.abs(newRawAmount);

    // Update DB with signed amount
    await this.transactionModel.findByIdAndUpdate(txId, { amount: newStoredAmount }).exec();

    // Apply new amount to balance (updateBalance takes raw positive + type)
    await this.balanceService.updateBalance(userId, newRawAmount, tx.transactionType, tx.transactionName, txId);

    this.logger.log(`Updated amount for transaction ${txId} (user ${userId}): ${newStoredAmount}`);
  }
  ```

  **Also add the import** for `editTransactionListButtons` and `editFieldButtons` at the top of `transaction.service.ts`. Find the existing buttons import:
  ```typescript
  import { backTranButton } from '../buttons';
  ```
  Replace with:
  ```typescript
  import { backTranButton, editTransactionListButtons } from '../buttons';
  ```
  (editFieldButtons is only needed in the handler, not the service.)

---

- [ ] **Step 4: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -10
  ```
  Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add repo/src/buttons/transacrion.buttons.ts \
          repo/src/service/transaction.service.ts \
          repo/src/type/interface/context.interface.ts
  git commit -m "feat(bot/edit): add edit buttons and transaction service methods"
  ```

---

## Task C2 — Wire edit actions into `TransactionHandler`

**Files:**
- Modify: `repo/src/handler/transaction.handler.ts`

**Context:** Read the full handler file before editing. The `@On('text')` handler already has `if (ctx.session.type === 'search') { ... }` and `if (ctx.session.type !== 'income' && ctx.session.type !== 'expense') { return next(); }`. You will add two new branches before the `income/expense` check.

---

- [ ] **Step 1: Add edit button and field button imports**

  Find the existing buttons import:
  ```typescript
  import { actionButtonsTransaction, backTranButton, categoryButtons } from '../buttons';
  ```
  Replace with:
  ```typescript
  import { actionButtonsTransaction, backTranButton, categoryButtons, editFieldButtons } from '../buttons';
  ```

---

- [ ] **Step 2: Add 5 new `@Action` handlers to `TransactionHandler`**

  Add these inside the class, after the existing `@Action('delete_last')` / `@Action(/delete_(.+)/)` handlers:

  ```typescript
  // ── Edit flow ──────────────────────────────────────────────────────────

  private readonly EDIT_FIELD_MESSAGE = {
    en: '✏️ What do you want to edit?',
    es: '✏️ ¿Qué quieres editar?',
    ua: '✏️ Що хочете редагувати?',
    pl: '✏️ Co chcesz edytować?',
  };

  private readonly ENTER_NEW_NAME_MESSAGE = {
    en: '📝 Enter the new transaction name:',
    es: '📝 Ingresa el nuevo nombre de la transacción:',
    ua: '📝 Введіть нову назву транзакції:',
    pl: '📝 Wpisz nową nazwę transakcji:',
  };

  private readonly ENTER_NEW_AMOUNT_MESSAGE = {
    en: '💰 Enter the new amount (numbers only):',
    es: '💰 Ingresa el nuevo monto (solo números):',
    ua: '💰 Введіть нову суму (тільки цифри):',
    pl: '💰 Wpisz nową kwotę (tylko liczby):',
  };

  private readonly EDIT_SUCCESS_MESSAGE = {
    en: '✅ Transaction updated.',
    es: '✅ Transacción actualizada.',
    ua: '✅ Транзакцію оновлено.',
    pl: '✅ Transakcja zaktualizowana.',
  };

  /** Entry: show the last 20 transactions for selection. */
  @Action('edit_last')
  async editLastCommand(ctx: IContext) {
    this.logger.log(`user:${ctx.from.id} edit_last`);
    ctx.session.type = 'edit_mode';
    delete ctx.session.editTransactionId;
    await this.transactionService.showLastNTransactionsWithEditOption(ctx, 20);
  }

  /** Transaction selected — show name/amount picker. */
  @Action(/edit_select_(.+)/)
  async editSelectCommand(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const txId = callbackData.replace('edit_select_', '');
    ctx.session.editTransactionId = txId;
    this.logger.log(`user:${ctx.from.id} edit_select txId=${txId}`);
    await ctx.editMessageText(
      this.EDIT_FIELD_MESSAGE[lang] ?? this.EDIT_FIELD_MESSAGE['en'],
      editFieldButtons(txId, lang),
    );
  }

  /** User chose to edit the name — ask for new name. */
  @Action(/edit_name_(.+)/)
  async editNameCommand(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const txId = callbackData.replace('edit_name_', '');
    ctx.session.editTransactionId = txId;
    ctx.session.type = 'edit_name';
    this.logger.log(`user:${ctx.from.id} edit_name txId=${txId}`);
    await ctx.editMessageText(
      this.ENTER_NEW_NAME_MESSAGE[lang] ?? this.ENTER_NEW_NAME_MESSAGE['en'],
      backTranButton(lang),
    );
  }

  /** User chose to edit the amount — ask for new amount. */
  @Action(/edit_amount_(.+)/)
  async editAmountCommand(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const txId = callbackData.replace('edit_amount_', '');
    ctx.session.editTransactionId = txId;
    ctx.session.type = 'edit_amount';
    this.logger.log(`user:${ctx.from.id} edit_amount txId=${txId}`);
    await ctx.editMessageText(
      this.ENTER_NEW_AMOUNT_MESSAGE[lang] ?? this.ENTER_NEW_AMOUNT_MESSAGE['en'],
      backTranButton(lang),
    );
  }
  ```

---

- [ ] **Step 3: Add two text-handler branches in `@On('text')`**

  In the `textCommand` method, find the block:
  ```typescript
  if (ctx.session.type === 'search') {
    // ... search branch
    return;
  }

  // ── Normal income/expense branch ──
  if (ctx.session.type !== 'income' && ctx.session.type !== 'expense') {
    return next();
  }
  ```

  Insert the two new branches **between** the `search` return and the `income/expense` guard:

  ```typescript
    // ── Edit name branch ─────────────────────────────────────────────────────
    if (ctx.session.type === 'edit_name') {
      const lang   = ctx.session.language || 'en';
      const txId   = ctx.session.editTransactionId;
      const userId = ctx.from.id;
      const newName = ((ctx.message as MyMessage).text || '').trim();
      if (!txId || !newName) return next();

      try {
        await this.transactionService.updateTransactionName(userId, txId, newName);
        delete ctx.session.type;
        delete ctx.session.editTransactionId;
        await ctx.reply(
          this.EDIT_SUCCESS_MESSAGE[lang] ?? this.EDIT_SUCCESS_MESSAGE['en'],
          backTranButton(lang),
        );
      } catch (error) {
        this.logger.error('Error in edit_name:', error);
        await ctx.reply(ERROR_MESSAGE[lang], backTranButton(lang));
      }
      return;
    }

    // ── Edit amount branch ────────────────────────────────────────────────────
    if (ctx.session.type === 'edit_amount') {
      const lang   = ctx.session.language || 'en';
      const txId   = ctx.session.editTransactionId;
      const userId = ctx.from.id;
      const raw    = ((ctx.message as MyMessage).text || '').trim();
      const newAmount = parseFloat(raw);

      if (!txId || isNaN(newAmount) || newAmount <= 0) {
        await ctx.reply(
          INVALID_DATA_MESSAGE[lang] ?? INVALID_DATA_MESSAGE['en'],
          backTranButton(lang),
        );
        return;
      }

      try {
        await this.transactionService.updateTransactionAmount(userId, txId, newAmount);
        delete ctx.session.type;
        delete ctx.session.editTransactionId;
        await ctx.reply(
          this.EDIT_SUCCESS_MESSAGE[lang] ?? this.EDIT_SUCCESS_MESSAGE['en'],
          backTranButton(lang),
        );
      } catch (error) {
        this.logger.error('Error in edit_amount:', error);
        await ctx.reply(ERROR_MESSAGE[lang], backTranButton(lang));
      }
      return;
    }
  ```

  **Note:** `ERROR_MESSAGE` and `INVALID_DATA_MESSAGE` are already imported in the handler. Use them as-is.

---

- [ ] **Step 4: Build to verify**

  ```bash
  cd repo && npm run build 2>&1 | tail -10
  ```
  Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add repo/src/handler/transaction.handler.ts
  git commit -m "feat(bot/edit): wire edit actions and text handlers in TransactionHandler"
  ```

---

## Self-review

**Spec coverage:**

| Requirement | Task | How |
|---|---|---|
| Edit button in transaction menu | C1 | `✏️ Edit` button in `actionButtonsTransaction()` |
| List last 20 transactions for selection | C1 | `showLastNTransactionsWithEditOption()` service method |
| Pick name or amount to edit | C1 + C2 | `editFieldButtons()` + `@Action(/edit_name_/)` + `@Action(/edit_amount_/)` |
| Update name in DB | C1 | `updateTransactionName()` — no balance change |
| Update amount in DB + balance | C1 | `updateTransactionAmount()` — reverse old, apply new |
| Wire entry/selection/field/text actions | C2 | 5 `@Action` handlers + 2 text branches |
| Session cleanup after edit | C2 | `delete ctx.session.type; delete ctx.session.editTransactionId;` |

**Placeholder scan:** No TBDs. All method bodies are fully written. ✓

**Type consistency:** `editTransactionId` added to session interface in C1, read in C2 as `ctx.session.editTransactionId`. ✓ `editTransactionListButtons` imported in service in C1. `editFieldButtons` imported in handler in C2. ✓

**Balance correctness:**
- `reverseTransaction(storedAmount)` undoes the signed amount from the DB (e.g. expense stored as -100 → balance +100)
- `updateBalance(positiveAmount, type)` applies the new positive value with sign from type (expense → -newAmount to balance)
- Net effect: balance moves from old to new correctly ✓
