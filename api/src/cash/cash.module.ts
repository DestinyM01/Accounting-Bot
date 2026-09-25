import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';
import { CategorySpendService } from './category-spend.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: CashAllocation.name, schema: CashAllocationSchema },
    ]),
  ],
  providers: [CategorySpendService],
  exports: [CategorySpendService],
})
export class CashModule {}
