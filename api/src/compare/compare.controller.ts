import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CompareService, CompareResult } from './compare.service';

@Controller('compare')
@UseGuards(JwtAuthGuard)
export class CompareController {
  constructor(private readonly compareService: CompareService) {}

  @Get('months')
  getMonths(): Promise<string[]> {
    return this.compareService.getAvailableMonths();
  }

  @Post()
  compare(@Body() dto: { monthA: string; monthB: string }): Promise<CompareResult> {
    return this.compareService.compare(dto.monthA, dto.monthB);
  }
}
