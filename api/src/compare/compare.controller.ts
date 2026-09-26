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
    // Express 5 leaves req.body undefined (not {}) when no body is sent; a
    // missing month still reaches compare(), which rejects the bad format
    // the same way an empty-object body always did.
    const { monthA, monthB } = dto ?? ({} as { monthA: string; monthB: string });
    return this.compareService.compare(monthA, monthB);
  }
}
