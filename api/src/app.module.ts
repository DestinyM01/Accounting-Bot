import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
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
import { CashModule } from './cash/cash.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ReportsModule } from './reports/reports.module';
import { HealthController } from './health/health.controller';
import { SettingsModule } from './settings/settings.module';
import { CalculatorModule } from './calculator/calculator.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URI || 'mongodb://mongodb-svc:27017/accbot?directConnection=true',
    ),
    ScheduleModule.forRoot(),
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
    CashModule,
    IngestionModule,
    ReportsModule,
    SettingsModule,
    CalculatorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
