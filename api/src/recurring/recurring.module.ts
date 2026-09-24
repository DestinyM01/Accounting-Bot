import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import { RecurringSchedulerService } from './recurring-scheduler.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recurring.name, schema: RecurringSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    CategoriesModule,
    LedgerModule,
  ],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringSchedulerService],
})
export class RecurringModule {}
