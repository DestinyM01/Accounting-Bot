import { Logger, Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import * as services from './service';
import * as scene from './scene';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseConfigService } from './mongodb/mongoose-config.service';
import * as handlers from './handler/index';
import { Balance, BalanceSchema } from './mongodb/schemas/balance.schemas';
import { Transaction, TransactionSchema } from './mongodb/schemas/transaction.schemas';
import { Budget, BudgetSchema } from './mongodb/schemas/budget.schemas';
import { Recurring, RecurringSchema } from './mongodb/schemas/recurring.schemas';
import { BalanceHistory, BalanceHistorySchema } from './mongodb/schemas/balance-history.schemas';
import { ScheduleModule } from '@nestjs/schedule';
import { OpenAiApiModule } from './open-ai-api/open-ai-api.module';
import { createSessionMiddleware, errorHandlingMiddleware } from './middleware';
import { Analytics, AnalyticsSchema } from './mongodb/schemas/analytics.schemas';
import { CustomCategory, CustomCategorySchema } from './mongodb/schemas/custom-category.schema';
import { HealthChecksController } from './api/health.checks.controller';

@Module({
  imports: [
    OpenAiApiModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    TelegrafModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        middlewares: [errorHandlingMiddleware(), createSessionMiddleware(configService)],
        token: configService.getOrThrow('TELEGRAM_TOKEN'),
        options: {
          // Maximum time (ms) allowed for a single update handler to complete.
          // Defaults to 90 000 in nestjs-telegraf; set explicitly for clarity.
          handlerTimeout: 90_000,
        },
        launchOptions: {
          // Give the initial getMe + polling setup up to 60 s before Telegraf
          // considers the connection failed. Combined with the initContainer
          // network-readiness check this prevents ETIMEDOUT crashes at startup.
          allowedUpdates: [],
          dropPendingUpdates: false,
        },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useClass: MongooseConfigService,
    }),
    MongooseModule.forFeature([
      { name: Balance.name, schema: BalanceSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Analytics.name, schema: AnalyticsSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
      { name: 'CustomCategory', schema: CustomCategorySchema },
    ]),
  ],

  providers: [Logger, ...Object.values(services), ...Object.values(handlers), ...Object.values(scene)],
  controllers: [HealthChecksController],
  exports: [],
})
export class AppModule {}
