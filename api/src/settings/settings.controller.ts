import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AccountsInput, ReportsInput, SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  view() {
    return this.settings.view();
  }

  @Put('reports')
  saveReports(@Body() body: ReportsInput) {
    return this.settings.saveReports(body ?? {});
  }

  @Put('accounts')
  saveAccounts(@Body() body: AccountsInput) {
    return this.settings.saveAccounts(body ?? {});
  }
}
