import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { BalanceHistory, BalanceHistorySchema } from '../shared/schemas/balance-history.schema';
import { CustomCategory, CustomCategorySchema } from '../shared/schemas/custom-category.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { IngestionService } from './ingestion.service';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Balance.name, schema: BalanceSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
      { name: CustomCategory.name, schema: CustomCategorySchema },
      { name: Recurring.name, schema: RecurringSchema },
    ]),
  ],
  providers: [IngestionService, MailClient, CategorizerService, FxService],
})
export class IngestionModule {}
