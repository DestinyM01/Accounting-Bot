import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';
import { CategoriesModule } from '../categories/categories.module';
import { CategorySpendService } from './category-spend.service';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';

// No LedgerModule, on purpose: items never move the balance (pinned in cash.service.spec.ts).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: CashAllocation.name, schema: CashAllocationSchema },
    ]),
    CategoriesModule,
  ],
  controllers: [CashController],
  providers: [CategorySpendService, CashService],
  exports: [CategorySpendService],
})
export class CashModule {}
