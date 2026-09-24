import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RecurringService, CreateRecurringBody } from './recurring.service';

@Controller('recurring')
@UseGuards(JwtAuthGuard)
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Get()
  list() {
    return this.recurringService.list();
  }

  @Post()
  create(@Body() body: CreateRecurringBody) {
    return this.recurringService.create(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string) {
    await this.recurringService.delete(id);
  }
}
