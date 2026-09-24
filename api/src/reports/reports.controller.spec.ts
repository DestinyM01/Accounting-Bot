// ReportsModule reaches a @Cron through the scheduler; @nestjs/schedule is
// ESM-only under this Jest setup.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined, ScheduleModule: { forRoot: () => ({ module: class {} }) } }));

import 'reflect-metadata';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ServiceUnavailableException } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsModule } from './reports.module';
import { ReportDataService } from './report-data.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { MailerService } from './mailer.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { StatisticsModule } from '../statistics/statistics.module';
import { StatisticsService } from '../statistics/statistics.service';
import { BudgetModule } from '../budget/budget.module';
import { BudgetService } from '../budget/budget.service';
import { AppModule } from '../app.module';
import { WeeklyReportData } from './report-types';

const at = (iso: string) => new Date(iso);
const WEEKLY_DATA: WeeklyReportData = {
  from: at('2026-09-21T04:00:00Z'),
  to: at('2026-09-28T04:00:00Z'),
  week: { spent: 18450, income: 45000, topCategories: [], largest: [] },
  month: { label: 'September', spent: 61200, income: 75000, net: 13800, budgets: [] },
  waiting: { unresolved: 0, toReview: 0 },
  health: { overdueRecurring: [], lastIngestedAt: at('2026-09-27T14:00:00Z'), daysSinceIngest: 0, ingestionStale: false },
};

describe('ReportsController', () => {
  it('is protected by JwtAuthGuard at class level', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ReportsController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('answers 202 Accepted', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ReportsController.prototype.sendTest)).toBe(202);
  });

  it('answers 503 and sends nothing when email is not configured', async () => {
    const mailer = { isConfigured: jest.fn().mockReturnValue(false), send: jest.fn() };
    const controller = new ReportsController({ weekly: jest.fn() } as any, mailer as any);
    await expect(controller.sendTest()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('emails the latest weekly digest now, marked [Test]', async () => {
    const data = { weekly: jest.fn().mockResolvedValue(WEEKLY_DATA) };
    const mailer = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(undefined) };
    const controller = new ReportsController(data as any, mailer as any);
    await expect(controller.sendTest()).resolves.toEqual({ ok: true });
    expect(data.weekly).toHaveBeenCalledWith(expect.objectContaining({ kind: 'weekly' }), expect.any(Date));
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/^\[Test\] Weekly digest · /) }),
    );
  });

  it('is wired: its module, the services it borrows, and the app', () => {
    expect(Reflect.getMetadata('providers', ReportsModule)).toEqual(
      expect.arrayContaining([MailerService, ReportDataService, ReportSchedulerService]),
    );
    expect(Reflect.getMetadata('controllers', ReportsModule)).toContain(ReportsController);
    expect(Reflect.getMetadata('imports', ReportsModule)).toEqual(expect.arrayContaining([StatisticsModule, BudgetModule]));
    expect(Reflect.getMetadata('exports', StatisticsModule)).toContain(StatisticsService);
    expect(Reflect.getMetadata('exports', BudgetModule)).toContain(BudgetService);
    expect(Reflect.getMetadata('imports', AppModule)).toContain(ReportsModule);
  });
});
