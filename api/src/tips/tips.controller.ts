import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TipsService } from './tips.service';

@Controller('tips')
@UseGuards(JwtAuthGuard)
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  @Get()
  getTips() {
    return this.tipsService.getTips();
  }

  /** Force-refresh past the 1-hour cache */
  @Post('refresh')
  refreshTips() {
    return this.tipsService.refreshTips();
  }
}
