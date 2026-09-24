import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { CategoriesModule } from '../categories/categories.module';
import { IngestionService } from './ingestion.service';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
    ]),
    LedgerModule,
    CategoriesModule,
  ],
  providers: [IngestionService, MailClient, CategorizerService, FxService],
})
export class IngestionModule {}
