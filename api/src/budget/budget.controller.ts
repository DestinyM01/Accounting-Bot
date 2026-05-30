import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { BudgetService } from './budget.service';

@Controller('budget')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  get(@Query('month') month?: string, @Query('year') year?: string) {
    return this.budgetService.get(
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
    );
  }

  @Post()
  @HttpCode(204)
  async set(
    @Body() body: { category: string; limitAmount: number; month?: number; year?: number },
  ) {
    await this.budgetService.set(body.category, body.limitAmount, body.month, body.year);
  }
}
