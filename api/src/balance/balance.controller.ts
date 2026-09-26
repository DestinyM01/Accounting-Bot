import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { BalanceService, SetBalanceBody } from './balance.service';

@Controller('balance')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  get() {
    return this.balanceService.get();
  }

  @Put()
  set(@Body() body: SetBalanceBody) {
    return this.balanceService.set(body);
  }

  @Get('history')
  history(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('reason') reason?: string,
    @Query('before') before?: string,
  ) {
    return this.balanceService.history({ limit, offset, reason, before });
  }

  @Get('daily')
  daily(@Query('days') days?: string) {
    return this.balanceService.daily({ days });
  }
}
