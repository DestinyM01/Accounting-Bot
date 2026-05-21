import { Middleware } from 'telegraf';
import { Mongo } from '@telegraf/session/mongodb';
import { IContext } from '../type/interface';
import { ConfigService } from '@nestjs/config';

export function createSessionMiddleware(configService: ConfigService): Middleware<IContext> {
  const monoUri = configService.get<string>('MONGO_URI');
  const mongodbUrl = monoUri ?? configService.getOrThrow('MONGODB_URL');
  const mongodbName = monoUri
    ? (monoUri.split('/').pop() || 'accbot')
    : configService.getOrThrow('MONGODB_NAME');

  const mongoStore = Mongo({
    url: mongodbUrl,
    database: mongodbName,
  });

  return async (ctx, next) => {
    const key = ctx.from && ctx.chat ? `${ctx.from.id}:${ctx.chat.id}` : null;

    if (key) {
      ctx.session = (await mongoStore.get(key)) || {};
      ctx.session.lastActivity = Date.now();
      await next();
      await mongoStore.set(key, ctx.session);
    } else {
      await next();
    }
  };
}
