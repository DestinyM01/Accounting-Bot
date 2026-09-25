import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { StatisticsModule } from '../statistics/statistics.module';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Balance.name, schema: BalanceSchema }]), StatisticsModule],
  controllers: [CalculatorController],
  providers: [CalculatorService],
})
export class CalculatorModule {}
