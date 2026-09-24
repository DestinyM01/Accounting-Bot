import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { BalanceHistory, BalanceHistorySchema } from '../shared/schemas/balance-history.schema';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Balance.name, schema: BalanceSchema },
      { name: BalanceHistory.name, schema: BalanceHistorySchema },
    ]),
    LedgerModule,
  ],
  controllers: [BalanceController],
  providers: [BalanceService],
})
export class BalanceModule {}
