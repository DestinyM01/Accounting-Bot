import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
@UseGuards(JwtAuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('summary')
  summary(@Query('month') month?: string, @Query('year') year?: string) {
    return this.statisticsService.summary(
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
    );
  }

  @Get('monthly')
  monthly() {
    return this.statisticsService.monthly();
  }

  @Get('by-category')
  byCategory(@Query('month') month?: string, @Query('year') year?: string) {
    return this.statisticsService.byCategory(
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
    );
  }
}
