import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Recurring.name, schema: RecurringSchema }]),
  ],
  controllers: [RecurringController],
  providers: [RecurringService],
})
export class RecurringModule {}
