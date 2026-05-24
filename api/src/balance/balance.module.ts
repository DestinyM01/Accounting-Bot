import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Balance.name, schema: BalanceSchema }])],
  controllers: [BalanceController],
  providers: [BalanceService],
})
export class BalanceModule {}
