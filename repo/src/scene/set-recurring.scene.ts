import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { WizardContext } from 'telegraf/typings/scenes';
import { IContext, MyMessage } from '../type/interface';
import { RecurringService, CustomCategoryService } from '../service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { Category } from '../type/enum/category.enum';
import { backTranButton } from '../buttons';
import { regex } from '../constants';
import { Markup } from 'telegraf';

const STEP_LABELS = {
  ask_type: {
    en: 'Is this an income or expense?\nReply: <b>income</b> or <b>expense</b>',
    ua: 'Це дохід чи витрата?\nВідповідь: <b>income</b> або <b>expense</b>',
    pl: 'To dochód czy wydatek?\nOdpowiedź: <b>income</b> lub <b>expense</b>',
    es: '¿Es un ingreso o un gasto?\nResponde: <b>income</b> o <b>expense</b>',
  },
  ask_transaction: {
    en: 'Enter the transaction name and amount (e.g. <b>Rent 1500</b>):',
    ua: 'Введіть назву і суму транзакції (наприклад <b>Оренда 1500</b>):',
    pl: 'Wprowadź nazwę i kwotę transakcji (np. <b>Czynsz 1500</b>):',
    es: 'Ingresa el nombre y monto de la transacción (ej. <b>Alquiler 1500</b>):',
  },
  ask_category: {
    en: 'Select a category for this recurring transaction:',
    ua: 'Оберіть категорію для цієї транзакції:',
    pl: 'Wybierz kategorię tej transakcji:',
    es: 'Selecciona una categoría para esta transacción recurrente:',
  },
  ask_day: {
    en: 'Which day of the month should this repeat? (1–28):',
    ua: 'Який день місяця для повторення? (1–28):',
    pl: 'Który dzień miesiąca ma się powtarzać? (1–28):',
    es: '¿Qué día del mes debe repetirse? (1–28):',
  },
  done: {
    en: '✅ Recurring transaction saved!',
    ua: '✅ Повторювана транзакція збережена!',
    pl: '✅ Cykliczna transakcja zapisana!',
    es: '✅ ¡Transacción recurrente guardada!',
  },
  invalid: {
    en: '⚠️ Invalid input. Please try again.',
    ua: '⚠️ Невірний ввід. Спробуйте ще раз.',
    pl: '⚠️ Nieprawidłowy wejście. Spróbuj ponownie.',
    es: '⚠️ Entrada inválida. Por favor intenta de nuevo.',
  },
};

const CATEGORY_BUTTON_LABELS: Record<string, string> = {
  food: '🍔 Food',
  transport: '🚌 Transport',
  housing: '🏠 Housing',
  health: '💊 Health',
  entertainment: '🎬 Entertainment',
  salary: '💼 Salary',
  savings: '🏦 Savings',
  other: '📌 Other',
};

function recurringCategoryButtons(customCategories: { name: string; emoji: string }[] = []) {
  const builtIn = Object.entries(CATEGORY_BUTTON_LABELS).map(([key, label]) =>
    Markup.button.callback(label, `rec_cat:${key}`),
  );
  const custom = customCategories.map((c) =>
    Markup.button.callback(`${c.emoji} ${c.name}`, `rec_cat:${c.name}`),
  );
  return Markup.inlineKeyboard([...builtIn, ...custom], { columns: 2 });
}

@Wizard('set_recurring')
export class SetRecurringScene {
  constructor(
    private readonly recurringService: RecurringService,
    private readonly customCategoryService: CustomCategoryService,
  ) {}

  @WizardStep(1)
  async askType(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'en';
    await ctx.replyWithHTML(STEP_LABELS.ask_type[lang] ?? STEP_LABELS.ask_type.en);
    ctx.wizard.next();
  }

  @WizardStep(2)
  @On('text')
  async getType(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'en';
    const text = (ctx.message as MyMessage).text.trim().toLowerCase();
    if (text !== 'income' && text !== 'expense') {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang] ?? STEP_LABELS.invalid.en);
      return;
    }
    (ctx.wizard.state as any).transactionType =
      text === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE;
    await ctx.replyWithHTML(STEP_LABELS.ask_transaction[lang] ?? STEP_LABELS.ask_transaction.en);
    ctx.wizard.next();
  }

  @WizardStep(3)
  @On('text')
  async getTransaction(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'en';
    const text = (ctx.message as MyMessage).text.trim();
    const matches = text.match(regex);
    if (!matches) {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang] ?? STEP_LABELS.invalid.en);
      return;
    }
    (ctx.wizard.state as any).transactionName = matches[1].trim().toLowerCase();
    (ctx.wizard.state as any).amount = Number(matches[2]);
    let customCats: { name: string; emoji: string }[] = [];
    try {
      const fetched = await this.customCategoryService.listCategories(ctx.from.id);
      customCats = fetched.map((c) => ({ name: c.name, emoji: c.emoji }));
    } catch (error) {
      // degrade gracefully — show built-in categories only
    }
    await ctx.replyWithHTML(
      STEP_LABELS.ask_category[lang] ?? STEP_LABELS.ask_category.en,
      recurringCategoryButtons(customCats),
    );
    ctx.wizard.next();
  }

  @WizardStep(4)
  @Action(/rec_cat:(.+)/)
  async getCategory(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'en';
    const callbackData = (ctx.callbackQuery as any)?.data as string;
    const category = callbackData?.replace('rec_cat:', '');
    (ctx.wizard.state as any).category = category;
    await ctx.answerCbQuery(`✅ ${CATEGORY_BUTTON_LABELS[category] ?? category}`);
    await ctx.replyWithHTML(STEP_LABELS.ask_day[lang] ?? STEP_LABELS.ask_day.en);
    ctx.wizard.next();
  }

  @WizardStep(5)
  @On('text')
  async getDay(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'en';
    const text = (ctx.message as MyMessage).text.trim();
    const day = parseInt(text, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang] ?? STEP_LABELS.invalid.en);
      return;
    }
    const state = ctx.wizard.state as any;
    await this.recurringService.createRecurring(
      ctx.from.id,
      ctx.from.first_name,
      state.transactionName,
      state.transactionType,
      state.amount,
      day,
      state.category ?? Category.OTHER,
    );
    await ctx.replyWithHTML(STEP_LABELS.done[lang] ?? STEP_LABELS.done.en, backTranButton(lang));
    await ctx.scene.leave();
  }
}
