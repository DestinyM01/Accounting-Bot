import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { IngestionStatus, IngestionStatusSchema } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail, UnreadableMailSchema } from '../shared/schemas/unreadable-mail.schema';
import { Migration, MigrationSchema } from '../shared/schemas/migration.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';
import { IngestionService } from './ingestion.service';
import { IngestionStatusService } from './ingestion-status.service';
import { IngestionController } from './ingestion.controller';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';
import { MailTimeBackfillService } from './mail-time-backfill.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: IngestionStatus.name, schema: IngestionStatusSchema },
      { name: UnreadableMail.name, schema: UnreadableMailSchema },
      { name: Migration.name, schema: MigrationSchema },
    ]),
    LedgerModule,
    CategoriesModule,
    SettingsModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, MailClient, CategorizerService, FxService, IngestionStatusService, MailTimeBackfillService],
})
export class IngestionModule {}
