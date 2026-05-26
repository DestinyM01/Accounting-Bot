import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AnalyticsService, TopTransaction, ChartPoint } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('top10')
  getTop10(): Promise<TopTransaction[]> {
    return this.analyticsService.getTop10();
  }

  @Get('chart/:name')
  getChart(@Param('name') name: string): Promise<ChartPoint[]> {
    return this.analyticsService.getTransactionChart(name);
  }
}
