import { Action, On, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { IContext } from '../type/interface';
import { BudgetService } from '../service';
import { Category } from '../type/enum/category.enum';
import { budgetCategorySelectButtons, budgetListButtons } from '../battons';
import { CustomCallbackQuery } from '../type/interface';

const BUDGET_MENU = {
  en: '💰 Budget Manager\nTrack your spending limits by category.',
  ua: '💰 Менеджер бюджету\nВідстежуйте ліміти витрат за категоріями.',
  pl: '💰 Menedżer budżetu\nŚledź limity wydatków według kategorii.',
};

const BUDGET_SELECT_CATEGORY = {
  en: 'Select a category to set a budget limit:',
  ua: 'Оберіть категорію для встановлення ліміту:',
  pl: 'Wybierz kategorię, aby ustawić limit budżetu:',
};

const BUDGET_ENTER_AMOUNT = {
  en: 'Enter the monthly limit amount for this category:',
  ua: 'Введіть місячний ліміт для цієї категорії:',
  pl: 'Wprowadź miesięczny limit dla tej kategorii:',
};

const BUDGET_SAVED = {
  en: '✅ Budget limit saved!',
  ua: '✅ Ліміт бюджету збережено!',
  pl: '✅ Limit budżetu zapisany!',
};

const BUDGET_OVER = {
  en: '⚠️ You have exceeded the budget for',
  ua: '⚠️ Ви перевищили бюджет для',
  pl: '⚠️ Przekroczyłeś budżet dla',
};

const NO_BUDGETS = {
  en: 'No budgets set for this month.',
  ua: 'Бюджети на цей місяць не встановлені.',
  pl: 'Brak budżetów na ten miesiąc.',
};

@Update()
export class BudgetHandler {
  private readonly logger: Logger = new Logger(BudgetHandler.name);

  constructor(private readonly budgetService: BudgetService) {}

  @Action('budgets')
  async budgetMenu(ctx: IContext) {
    const lang = ctx.session.language || 'ua';
    await ctx.editMessageText(BUDGET_MENU[lang], budgetListButtons(lang));
  }

  @Action('budget_set')
  async budgetSet(ctx: IContext) {
    const lang = ctx.session.language || 'ua';
    await ctx.editMessageText(BUDGET_SELECT_CATEGORY[lang], budgetCategorySelectButtons(lang));
  }

  @Action(/budget_cat_(.+)/)
  async budgetCategorySelected(ctx: IContext) {
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const category = callbackData.replace('budget_cat_', '') as Category;
    const lang = ctx.session.language || 'ua';
    ctx.session.budgetCategory = category;
    ctx.session.type = 'balance';
    await ctx.editMessageText(`${BUDGET_ENTER_AMOUNT[lang]} (${category})`);
    await ctx.answerCbQuery();
  }

  @On('text')
  async handleBudgetAmount(ctx: IContext) {
    if (!ctx.session.budgetCategory) return;
    const text = (ctx.message as any)?.text?.trim();
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return;

    const lang = ctx.session.language || 'ua';
    const category = ctx.session.budgetCategory as Category;
    await this.budgetService.setBudget(ctx.from.id, category, amount);
    delete ctx.session.budgetCategory;
    delete ctx.session.type;

    await ctx.reply(BUDGET_SAVED[lang], budgetListButtons(lang));
  }

  @Action('budget_list')
  async budgetList(ctx: IContext) {
    const lang = ctx.session.language || 'ua';
    const budgets = await this.budgetService.getBudgets(ctx.from.id);
    if (budgets.length === 0) {
      await ctx.editMessageText(NO_BUDGETS[lang], budgetListButtons(lang));
      return;
    }
    const lines = await Promise.all(
      budgets.map(async (b) => {
        const check = await this.budgetService.checkBudget(ctx.from.id, b.category);
        const over = check?.over ? ` ${BUDGET_OVER[lang]} ⚠️` : '';
        const spent = check?.spent ?? 0;
        return `${b.category}: ${spent}/${b.limitAmount}${over}`;
      }),
    );
    await ctx.editMessageText(`📊 ${lines.join('\n')}`, budgetListButtons(lang));
  }
}
