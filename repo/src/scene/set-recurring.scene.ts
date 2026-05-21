import { Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { WizardContext } from 'telegraf/typings/scenes';
import { IContext, MyMessage } from '../type/interface';
import { RecurringService } from '../service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { backTranButton } from '../battons';
import { regex } from '../constants';

const STEP_LABELS = {
  ask_type: {
    en: 'Is this an income or expense?\nReply: <b>income</b> or <b>expense</b>',
    ua: 'Це дохід чи витрата?\nВідповідь: <b>income</b> або <b>expense</b>',
    pl: 'To dochód czy wydatek?\nOdpowiedź: <b>income</b> lub <b>expense</b>',
  },
  ask_transaction: {
    en: 'Enter the transaction name and amount (e.g. <b>Rent 1500</b>):',
    ua: 'Введіть назву і суму транзакції (наприклад <b>Оренда 1500</b>):',
    pl: 'Wprowadź nazwę i kwotę transakcji (np. <b>Czynsz 1500</b>):',
  },
  ask_day: {
    en: 'Which day of the month should this repeat? (1–28):',
    ua: 'Який день місяця для повторення? (1–28):',
    pl: 'Który dzień miesiąca ma się powtarzać? (1–28):',
  },
  done: {
    en: '✅ Recurring transaction saved!',
    ua: '✅ Повторювана транзакція збережена!',
    pl: '✅ Cykliczna transakcja zapisana!',
  },
  invalid: {
    en: '⚠️ Invalid input. Please try again.',
    ua: '⚠️ Невірний ввід. Спробуйте ще раз.',
    pl: '⚠️ Nieprawidłowy wejście. Spróbuj ponownie.',
  },
};

@Wizard('set_recurring')
export class SetRecurringScene {
  constructor(private readonly recurringService: RecurringService) {}

  @WizardStep(1)
  @On('text')
  async askType(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'ua';
    await ctx.replyWithHTML(STEP_LABELS.ask_type[lang]);
    ctx.wizard.next();
  }

  @WizardStep(2)
  @On('text')
  async getType(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'ua';
    const text = (ctx.message as MyMessage).text.trim().toLowerCase();
    if (text !== 'income' && text !== 'expense') {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang]);
      return;
    }
    (ctx.wizard.state as any).transactionType =
      text === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE;
    await ctx.replyWithHTML(STEP_LABELS.ask_transaction[lang]);
    ctx.wizard.next();
  }

  @WizardStep(3)
  @On('text')
  async getTransaction(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'ua';
    const text = (ctx.message as MyMessage).text.trim();
    const matches = text.match(regex);
    if (!matches) {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang]);
      return;
    }
    (ctx.wizard.state as any).transactionName = matches[1].trim().toLowerCase();
    (ctx.wizard.state as any).amount = Number(matches[2]);
    await ctx.replyWithHTML(STEP_LABELS.ask_day[lang]);
    ctx.wizard.next();
  }

  @WizardStep(4)
  @On('text')
  async getDay(@Ctx() ctx: IContext & WizardContext) {
    const lang = ctx.session.language || 'ua';
    const text = (ctx.message as MyMessage).text.trim();
    const day = parseInt(text, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      await ctx.replyWithHTML(STEP_LABELS.invalid[lang]);
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
    );
    await ctx.replyWithHTML(STEP_LABELS.done[lang], backTranButton(lang));
    await ctx.scene.leave();
  }
}
