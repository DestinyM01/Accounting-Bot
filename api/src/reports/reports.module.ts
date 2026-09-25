import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { ReportSend, ReportSendSchema } from '../shared/schemas/report-send.schema';
import { StatisticsModule } from '../statistics/statistics.module';
import { BudgetModule } from '../budget/budget.module';
import { CashModule } from '../cash/cash.module';
import { SettingsModule } from '../settings/settings.module';
import { MailerService } from './mailer.service';
import { ReportDataService } from './report-data.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: ReportSend.name, schema: ReportSendSchema },
    ]),
    StatisticsModule,
    BudgetModule,
    CashModule,
    SettingsModule,
  ],
  controllers: [ReportsController],
  providers: [MailerService, ReportDataService, ReportSchedulerService],
})
export class ReportsModule {}
