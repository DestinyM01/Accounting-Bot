import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Recurring, RecurringSchema } from '../shared/schemas/recurring.schema';
import { CategoriesModule } from '../categories/categories.module';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Recurring.name, schema: RecurringSchema }]),
    CategoriesModule,
  ],
  controllers: [RecurringController],
  providers: [RecurringService],
})
export class RecurringModule {}
