import { Controller, HttpCode, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MailerService } from './mailer.service';
import { ReportDataService } from './report-data.service';
import { latestWeekly } from './report-periods';
import { renderWeekly } from './report-render';
import { dashboardUrl } from './dashboard-url';
import { SettingsService } from '../settings/settings.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly data: ReportDataService,
    private readonly mailer: MailerService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Emails the latest weekly digest right now, marked [Test], so the user can
   * see it without waiting for Monday. Records nothing: the scheduled digest
   * is unaffected.
   */
  @Post('test')
  @HttpCode(202)
  async sendTest(): Promise<{ ok: true }> {
    const { recipient } = await this.settings.reports();
    if (!this.mailer.isConfigured() || !recipient) {
      throw new ServiceUnavailableException('Email is not configured on the server');
    }
    const now = new Date();
    const period = latestWeekly(now);
    const email = renderWeekly(await this.data.weekly(period, now), { webUrl: dashboardUrl(), test: true });
    await this.mailer.send(email, recipient);
    return { ok: true };
  }
}
