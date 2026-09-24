import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../schemas/balance.schema';
import { BalanceHistory, BalanceHistorySchema } from '../schemas/balance-history.schema';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Balance.name, schema: BalanceSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
    ]),
  ],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
