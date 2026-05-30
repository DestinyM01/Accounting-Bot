import { Action, On, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { IContext } from '../type/interface';
import { BudgetService } from '../service';
import { Category } from '../type/enum/category.enum';
import { budgetCategorySelectButtons, budgetListButtons } from '../buttons';
import { CustomCallbackQuery } from '../type/interface';

const BUDGET_MENU = {
  en: '💰 Budget Manager\nTrack your spending limits by category.',
  es: '💰 Gestor de Presupuesto\nRealiza un seguimiento de tus límites de gasto por categoría.',
  ua: '💰 Менеджер бюджету\nВідстежуйте ліміти витрат за категоріями.',
  pl: '💰 Menedżer budżetu\nŚledź limity wydatków według kategorii.',
};

const BUDGET_SELECT_CATEGORY = {
  en: 'Select a category to set a budget limit:',
  es: 'Selecciona una categoría para establecer un límite de presupuesto:',
  ua: 'Оберіть категорію для встановлення ліміту:',
  pl: 'Wybierz kategorię, aby ustawić limit budżetu:',
};

const BUDGET_ENTER_AMOUNT = {
  en: 'Enter the monthly limit amount for this category:',
  es: 'Ingresa el límite mensual para esta categoría:',
  ua: 'Введіть місячний ліміт для цієї категорії:',
  pl: 'Wprowadź miesięczny limit dla tej kategorii:',
};

const BUDGET_SAVED = {
  en: '✅ Budget limit saved!',
  es: '✅ ¡Límite de presupuesto guardado!',
  ua: '✅ Ліміт бюджету збережено!',
  pl: '✅ Limit budżetu zapisany!',
};

const BUDGET_OVER = {
  en: '⚠️ You have exceeded the budget for',
  es: '⚠️ Has excedido el presupuesto para',
  ua: '⚠️ Ви перевищили бюджет для',
  pl: '⚠️ Przekroczyłeś budżet dla',
};

const NO_BUDGETS = {
  en: 'No budgets set for this month.',
  es: 'No hay presupuestos establecidos para este mes.',
  ua: 'Бюджети на цей місяць не встановлені.',
  pl: 'Brak budżetów na ten miesiąc.',
};

@Update()
export class BudgetHandler {
  private readonly logger: Logger = new Logger(BudgetHandler.name);

  constructor(private readonly budgetService: BudgetService) {}

  @Action('budgets')
  async budgetMenu(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.editMessageText(BUDGET_MENU[lang] ?? BUDGET_MENU.en, budgetListButtons(lang));
  }

  @Action('budget_set')
  async budgetSet(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.editMessageText(BUDGET_SELECT_CATEGORY[lang] ?? BUDGET_SELECT_CATEGORY.en, budgetCategorySelectButtons(lang));
  }

  @Action(/budget_cat_(.+)/)
  async budgetCategorySelected(ctx: IContext) {
    const callbackData = (ctx.callbackQuery as CustomCallbackQuery).data;
    const category = callbackData.replace('budget_cat_', '') as Category;
    const lang = ctx.session.language || 'en';
    ctx.session.budgetCategory = category;
    await ctx.editMessageText(`${BUDGET_ENTER_AMOUNT[lang] ?? BUDGET_ENTER_AMOUNT.en} (${category})`);
    await ctx.answerCbQuery();
  }

  @On('text')
  async handleBudgetAmount(ctx: IContext) {
    if (!ctx.session.budgetCategory) return;
    const text = (ctx.message as any)?.text?.trim();
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return;

    const lang = ctx.session.language || 'en';
    const category = ctx.session.budgetCategory as Category;
    try {
      await this.budgetService.setBudget(ctx.from.id, category, amount);
      delete ctx.session.budgetCategory;
      delete ctx.session.type;
      await ctx.reply(BUDGET_SAVED[lang] ?? BUDGET_SAVED.en, budgetListButtons(lang));
    } catch (err) {
      this.logger.error(`handleBudgetAmount error`, err);
    }
  }

  @Action('budget_list')
  async budgetList(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    const budgets = await this.budgetService.getBudgets(ctx.from.id);
    if (budgets.length === 0) {
      await ctx.editMessageText(NO_BUDGETS[lang] ?? NO_BUDGETS.en, budgetListButtons(lang));
      return;
    }
    const lines = await Promise.all(
      budgets.map(async (b) => {
        const check = await this.budgetService.checkBudget(ctx.from.id, b.category);
        const over = check?.over ? ` ${BUDGET_OVER[lang] ?? BUDGET_OVER.en} ⚠️` : '';
        const spent = check?.spent ?? 0;
        return `${b.category}: ${spent}/${b.limitAmount}${over}`;
      }),
    );
    await ctx.editMessageText(`📊 ${lines.join('\n')}`, budgetListButtons(lang));
  }
}
