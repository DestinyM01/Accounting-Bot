import { Action, Ctx, On, Wizard, WizardStep } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { WizardContext } from 'telegraf/typings/scenes';
import { IContext, MyMessage } from '../type/interface';
import { CustomCategoryService } from '../service';
import { backTranButton, colorPickerButtons, emojiPickerButtons } from '../buttons';

const BUILT_IN_NAMES = new Set([
  'food', 'transport', 'housing', 'health',
  'entertainment', 'salary', 'savings', 'other',
]);

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
  error: {
    en: '⚠️ Something went wrong. Please try again.',
    es: '⚠️ Algo salió mal. Por favor intenta de nuevo.',
    ua: '⚠️ Щось пішло не так. Спробуйте ще раз.',
    pl: '⚠️ Coś poszło nie tak. Spróbuj ponownie.',
  },
  reserved_name: {
    en: '⚠️ That name is a built-in category. Choose a different name:',
    es: '⚠️ Ese nombre es una categoría predefinida. Elige otro nombre:',
    ua: '⚠️ Ця назва вже є вбудованою категорією. Оберіть іншу:',
    pl: '⚠️ Ta nazwa to wbudowana kategoria. Wybierz inną nazwę:',
  },
};

@Wizard('create_category')
export class CreateCategoryScene {
  private readonly logger = new Logger(CreateCategoryScene.name);

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
    if (BUILT_IN_NAMES.has(raw)) {
      await ctx.replyWithHTML(MSGS.reserved_name[lang] ?? MSGS.reserved_name.en);
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

    // Guard: if the wizard state is incomplete (e.g. scene re-entered), bail cleanly
    if (!state.name || !state.color) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(MSGS.error[lang] ?? MSGS.error.en, backTranButton(lang));
      await ctx.scene.leave();
      return;
    }

    try {
      await this.customCategoryService.createCategory(ctx.from.id, state.name, emoji, state.color);
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `${emoji} <b>${state.name}</b> — ${MSGS.done[lang] ?? MSGS.done.en}`,
        { ...backTranButton(lang), parse_mode: 'HTML' },
      );
    } catch (error) {
      this.logger.error(`Failed to create category for user ${ctx.from.id}:`, error);
      await ctx.answerCbQuery();
      await ctx.editMessageText(MSGS.error[lang] ?? MSGS.error.en, backTranButton(lang));
    }
    await ctx.scene.leave();
  }
}
