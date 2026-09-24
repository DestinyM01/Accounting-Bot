import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';

// @nestjs/schedule is ESM-only under this Jest setup; the stub records each
// cron expression with its options so the schedule itself can be asserted.
jest.mock('@nestjs/schedule', () => {
  const crons: Array<[string, unknown]> = [];
  return {
    __crons: crons,
    Cron: (expression: string, options?: unknown) => {
      crons.push([expression, options]);
      return () => undefined;
    },
  };
});
jest.mock('./report-periods', () => ({
  ...jest.requireActual('./report-periods'),
  latestPeriods: jest.fn(),
}));
// Implementations are set in beforeEach, not here: whether jest.restoreAllMocks
// resets a jest.fn's implementation varies across Jest 29 releases.
jest.mock('./report-render', () => ({ renderWeekly: jest.fn(), renderMonthly: jest.fn() }));

import { ReportSchedulerService } from './report-scheduler.service';
import { ReportSend } from '../shared/schemas/report-send.schema';
import { ReportDataService } from './report-data.service';
import { MailerService } from './mailer.service';
import { latestPeriods, ReportPeriod } from './report-periods';
import { renderMonthly, renderWeekly } from './report-render';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-28T11:20:00Z');
const WEEKLY: ReportPeriod = {
  kind: 'weekly',
  key: '2026-W39',
  from: at('2026-09-21T04:00:00Z'),
  to: at('2026-09-28T04:00:00Z'),
  dueAt: at('2026-09-28T11:00:00Z'),
  expired: false,
};
const MONTHLY: ReportPeriod = {
  kind: 'monthly',
  key: '2026-08',
  from: at('2026-08-01T00:00:00Z'),
  to: at('2026-09-01T00:00:00Z'),
  dueAt: at('2026-09-01T11:00:00Z'),
  expired: false,
};
const latest = latestPeriods as jest.Mock;
const found = (doc: unknown) => ({ lean: jest.fn().mockResolvedValue(doc) });

describe('ReportSchedulerService', () => {
  let service: ReportSchedulerService;
  let sendModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; create: jest.Mock; updateOne: jest.Mock; deleteOne: jest.Mock };
  let data: { weekly: jest.Mock; monthly: jest.Mock };
  let mailer: { isConfigured: jest.Mock; send: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    latest.mockReset().mockReturnValue([WEEKLY]);
    (renderWeekly as jest.Mock).mockReset().mockReturnValue({ subject: 'weekly', html: '<p>w</p>', text: 'w' });
    (renderMonthly as jest.Mock).mockReset().mockReturnValue({ subject: 'monthly', html: '<p>m</p>', text: 'm' });
    sendModel = {
      findOne: jest.fn().mockReturnValue(found(null)),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    data = { weekly: jest.fn().mockResolvedValue({ kind: 'weekly-data' }), monthly: jest.fn().mockResolvedValue({ kind: 'monthly-data' }) };
    mailer = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(undefined) };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSchedulerService,
        { provide: getModelToken(ReportSend.name), useValue: sendModel },
        { provide: ReportDataService, useValue: data },
        { provide: MailerService, useValue: mailer },
      ],
    }).compile();
    service = module.get(ReportSchedulerService);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const key = { kind: 'weekly', period: '2026-W39' };

  it('runs hourly at minute 20, never overlapping itself', () => {
    const { __crons } = jest.requireMock('@nestjs/schedule');
    expect(__crons).toContainEqual(['20 * * * *', { waitForCompletion: true }]);
  });

  it('claims a due digest, sends it once and records it', async () => {
    await service.run(NOW);
    expect(sendModel.create).toHaveBeenCalledWith({ ...key, status: 'sending', at: NOW });
    expect(data.weekly).toHaveBeenCalledWith(WEEKLY, NOW);
    expect(renderWeekly).toHaveBeenCalledWith({ kind: 'weekly-data' }, { webUrl: expect.any(String) });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledWith({ subject: 'weekly', html: '<p>w</p>', text: 'w' });
    expect(sendModel.updateOne).toHaveBeenCalledWith(key, { $set: { status: 'sent', at: NOW } });
    expect(logSpy).toHaveBeenCalledWith('Report run: sent 1, skipped 0, failed 0');
  });

  it('builds the monthly summary from its own data', async () => {
    latest.mockReturnValue([MONTHLY]);
    await service.run(NOW);
    expect(data.monthly).toHaveBeenCalledWith(MONTHLY);
    expect(renderMonthly).toHaveBeenCalled();
    expect(mailer.send).toHaveBeenCalledWith({ subject: 'monthly', html: '<p>m</p>', text: 'm' });
  });

  it('releases the claim when sending fails, so the next hour retries', async () => {
    mailer.send.mockRejectedValue(new Error('SMTP 421'));
    await service.run(NOW);
    expect(sendModel.deleteOne).toHaveBeenCalledWith({ ...key, status: 'sending', at: NOW });
    expect(sendModel.updateOne).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('weekly report 2026-W39'), expect.any(String));
    expect(logSpy).toHaveBeenCalledWith('Report run: sent 0, skipped 0, failed 1');
  });

  it('does not send when another pod claimed it first', async () => {
    sendModel.create.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    await service.run(NOW);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it.each(['sent', 'skipped'])('does nothing for a %s record', async (status) => {
    sendModel.findOne.mockReturnValue(found({ ...key, status, at: NOW }));
    await service.run(NOW);
    expect(sendModel.create).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Report run'));
  });

  it('takes over a claim abandoned for more than 30 minutes and sends it', async () => {
    sendModel.findOne.mockReturnValue(found({ ...key, status: 'sending', at: at('2026-09-28T10:30:00Z') }));
    sendModel.findOneAndUpdate.mockResolvedValue({ ...key, status: 'sending' });
    await service.run(NOW);
    expect(sendModel.findOneAndUpdate).toHaveBeenCalledWith(
      { ...key, status: 'sending', at: { $lt: at('2026-09-28T10:50:00Z') } },
      { $set: { at: NOW } },
    );
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('leaves a fresh claim to the pod sending it', async () => {
    sendModel.findOne.mockReturnValue(found({ ...key, status: 'sending', at: at('2026-09-28T11:10:00Z') }));
    await service.run(NOW);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('records an expired report as skipped, never sends it, and warns once', async () => {
    latest.mockReturnValue([{ ...WEEKLY, expired: true }]);
    await service.run(NOW);
    expect(sendModel.create).toHaveBeenCalledWith({ ...key, status: 'skipped', at: NOW });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2026-W39'));
    expect(logSpy).toHaveBeenCalledWith('Report run: sent 0, skipped 1, failed 0');
  });

  it('marks an abandoned claim skipped instead of sending it late', async () => {
    latest.mockReturnValue([{ ...WEEKLY, expired: true }]);
    sendModel.findOne.mockReturnValue(found({ ...key, status: 'sending', at: at('2026-09-20T10:00:00Z') }));
    sendModel.findOneAndUpdate.mockResolvedValue({ ...key, status: 'sending' });
    await service.run(NOW);
    expect(sendModel.findOneAndUpdate).toHaveBeenCalledWith(expect.anything(), { $set: { status: 'skipped', at: NOW } });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('with no Gmail credentials records nothing and stops', async () => {
    latest.mockReturnValue([WEEKLY, MONTHLY]);
    mailer.isConfigured.mockReturnValue(false);
    await service.run(NOW);
    expect(sendModel.create).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mailer.isConfigured).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the record when the email went out but could not be marked', async () => {
    sendModel.updateOne.mockRejectedValue(new Error('write conflict'));
    await service.run(NOW);
    expect(sendModel.deleteOne).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('may be sent again'), expect.any(String));
    expect(logSpy).toHaveBeenCalledWith('Report run: sent 1, skipped 0, failed 0');
  });

  it('does not start a second run while one is in flight', async () => {
    let release!: (doc: unknown) => void;
    sendModel.findOne.mockReturnValueOnce({ lean: () => new Promise((resolve) => (release = resolve)) });
    const first = service.run(NOW);
    await service.run(NOW);
    expect(sendModel.findOne).toHaveBeenCalledTimes(1);
    release({ ...key, status: 'sent', at: NOW });
    await first;
  });
});
