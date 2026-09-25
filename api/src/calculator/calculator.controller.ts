import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CalculatorService } from './calculator.service';

@Controller('calculator')
@UseGuards(JwtAuthGuard)
export class CalculatorController {
  constructor(private readonly calculator: CalculatorService) {}

  @Get('compound')
  compound(@Query() query: Record<string, unknown>) {
    return this.calculator.compound(query);
  }

  @Get('my-numbers')
  myNumbers() {
    return this.calculator.myNumbers();
  }
}
