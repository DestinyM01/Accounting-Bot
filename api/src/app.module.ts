import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { BalanceModule } from './balance/balance.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BudgetModule } from './budget/budget.module';
import { StatisticsModule } from './statistics/statistics.module';
import { TipsModule } from './tips/tips.module';
import { RecurringModule } from './recurring/recurring.module';
import { CompareModule } from './compare/compare.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CategoriesModule } from './categories/categories.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URI || 'mongodb://mongodb-svc:27017/accbot',
    ),
    AuthModule,
    BalanceModule,
    TransactionsModule,
    BudgetModule,
    StatisticsModule,
    TipsModule,
    RecurringModule,
    CompareModule,
    AnalyticsModule,
    CategoriesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
