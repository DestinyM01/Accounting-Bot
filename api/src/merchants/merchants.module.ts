import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MerchantCategory, MerchantCategorySchema } from '../shared/schemas/merchant-category.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CategoriesModule } from '../categories/categories.module';
import { MerchantMemoryService } from './merchant-memory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MerchantCategory.name, schema: MerchantCategorySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    CategoriesModule,
  ],
  providers: [MerchantMemoryService],
  exports: [MerchantMemoryService],
})
export class MerchantsModule {}
