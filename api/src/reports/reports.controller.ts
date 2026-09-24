import { Controller, HttpCode, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MailerService } from './mailer.service';
import { ReportDataService } from './report-data.service';
import { latestWeekly } from './report-periods';
import { renderWeekly } from './report-render';
import { dashboardUrl } from './dashboard-url';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly data: ReportDataService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Emails the latest weekly digest right now, marked [Test], so the user can
   * see it without waiting for Monday. Records nothing: the scheduled digest
   * is unaffected.
   */
  @Post('test')
  @HttpCode(202)
  async sendTest(): Promise<{ ok: true }> {
    if (!this.mailer.isConfigured()) {
      throw new ServiceUnavailableException('Email is not configured on the server');
    }
    const now = new Date();
    const period = latestWeekly(now);
    const email = renderWeekly(await this.data.weekly(period, now), { webUrl: dashboardUrl(), test: true });
    await this.mailer.send(email);
    return { ok: true };
  }
}
