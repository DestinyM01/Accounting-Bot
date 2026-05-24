import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The Angular nginx proxy forwards requests to this service, so the browser
  // Origin header (https://bot.andujaronline.uk) must be allowed.
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'https://bot.andujaronline.uk',
    methods: ['GET'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  await app.listen(process.env.PORT || 4000);
}
bootstrap();
