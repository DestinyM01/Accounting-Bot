import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CashModule } from '../cash/cash.module';
import { CompareController } from './compare.controller';
import { CompareService } from './compare.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
    CashModule,
  ],
  controllers: [CompareController],
  providers:   [CompareService],
})
export class CompareModule {}
