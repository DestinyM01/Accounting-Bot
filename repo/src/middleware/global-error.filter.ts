import { IContext } from '../type/interface';
import { Middleware } from 'telegraf';
import { actionButtonsStart, backStartButton } from '../buttons';
import { MAIN_MENU } from '../constants';

export function errorHandlingMiddleware(): Middleware<IContext> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const lang = ctx.session?.language || 'en';
      const bosId = process.env.BOSID;
      try {
        await ctx.telegram.sendMessage(bosId, `Error: ${error.message}`, backStartButton());
      } catch (_) { /* ignore if bot message to admin fails */ }
      if (error.response && error.response.status === 400) {
        return;
      }
      try {
        await ctx.replyWithHTML(`${MAIN_MENU[lang] ?? MAIN_MENU['en']}`, {
          parse_mode: 'HTML',
          reply_markup: actionButtonsStart(lang, ctx.session?.isPremium).reply_markup,
        });
      } catch (_) { /* ignore reply failure */ }
    }
  };
}
