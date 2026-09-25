import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomCategory, CustomCategorySchema } from '../shared/schemas/custom-category.schema';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { Budget, BudgetSchema } from '../shared/schemas/budget.schema';
import { CashAllocation, CashAllocationSchema } from '../shared/schemas/cash-allocation.schema';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoryReferencesService } from './category-references.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomCategory.name, schema: CustomCategorySchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Recurring.name, schema: RecurringSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: CashAllocation.name, schema: CashAllocationSchema },
    ]),
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryReferencesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
