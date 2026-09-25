import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { IngestionStatus, IngestionStatusSchema } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail, UnreadableMailSchema } from '../shared/schemas/unreadable-mail.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';
import { IngestionService } from './ingestion.service';
import { IngestionStatusService } from './ingestion-status.service';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: IngestionStatus.name, schema: IngestionStatusSchema },
      { name: UnreadableMail.name, schema: UnreadableMailSchema },
    ]),
    LedgerModule,
    CategoriesModule,
    SettingsModule,
  ],
  providers: [IngestionService, MailClient, CategorizerService, FxService, IngestionStatusService],
})
export class IngestionModule {}
