import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // On SIGTERM (a rollout or node drain), run the shutdown hooks: the
  // schedulers finish the run in flight before the database connection closes.
  app.enableShutdownHooks();

  // The Angular nginx proxy forwards requests to this service, so the browser
  // Origin header (https://bot.andujaronline.uk) must be allowed.
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'https://bot.andujaronline.uk',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  await app.listen(process.env.PORT || 4000);
}
bootstrap();
