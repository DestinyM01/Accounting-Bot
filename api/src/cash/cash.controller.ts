import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CashItemInput, CashService } from './cash.service';

@Controller('cash')
@UseGuards(JwtAuthGuard)
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('withdrawals/:id')
  breakdown(@Param('id') id: string) {
    return this.cash.breakdown(id);
  }

  @Post('withdrawals/:id/allocations')
  @HttpCode(201)
  add(@Param('id') id: string, @Body() body: CashItemInput) {
    return this.cash.add(id, body ?? {});
  }

  @Delete('allocations/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.cash.remove(id);
  }
}
