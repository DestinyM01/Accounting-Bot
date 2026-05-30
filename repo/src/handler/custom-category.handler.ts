import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { WizardContext } from 'telegraf/typings/scenes';
import { IContext, CustomCallbackQuery } from '../type/interface';
import { CustomCategoryService } from '../service';
import { backTranButton } from '../buttons';

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
  add_btn:  { en: '➕ Add',  es: '➕ Agregar', ua: '➕ Додати', pl: '➕ Dodaj' },
  back_btn: { en: '↩️ Back', es: '↩️ Volver',  ua: '↩️ Назад',  pl: '↩️ Wróć' },
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
      await ctx.editMessageText(MSGS.empty[l] ?? MSGS.empty.en, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: MSGS.add_btn[l], callback_data: 'add_category' }],
            [{ text: MSGS.back_btn[l], callback_data: 'backT' }],
          ],
        },
      });
      return;
    }

    await ctx.editMessageText(MSGS.menu_title[l] ?? MSGS.menu_title.en, {
      ...categoryMenuButtons(
        cats.map((c) => ({ _id: (c as any)._id, name: c.name, emoji: c.emoji })),
        l,
      ),
      parse_mode: 'HTML',
    });
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
    await ctx.editMessageText(MSGS.deleted[lang] ?? MSGS.deleted.en, backTranButton(lang));
  }

  @Action('noop')
  async noop(ctx: IContext) {
    await ctx.answerCbQuery();
  }
}
