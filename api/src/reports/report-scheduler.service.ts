import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { ReportSend } from '../shared/schemas/report-send.schema';
import { MailerService } from './mailer.service';
import { ReportDataService } from './report-data.service';
import { latestPeriods, MONTHLY_WINDOW_DAYS, ReportPeriod, WEEKLY_WINDOW_DAYS } from './report-periods';
import { renderMonthly, renderWeekly } from './report-render';
import { dashboardUrl } from './dashboard-url';

/** A 'sending' claim older than this belongs to a pod that died mid-send. */
export const STALE_CLAIM_MINUTES = 30;

type Outcome = 'sent' | 'skipped' | 'failed';

/**
 * Emails the weekly digest and the monthly summary, each exactly once. A
 * ReportSend record is claimed before sending (unique per kind and period);
 * a refused send releases it so the next hour retries, until the report's
 * window closes and it is recorded as skipped.
 */
@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);
  /** Set while a run is in flight so a slow run is never overlapped by the next tick. */
  private running = false;

  constructor(
    @InjectModel(ReportSend.name) private readonly sendModel: Model<ReportSend>,
    private readonly data: ReportDataService,
    private readonly mailer: MailerService,
  ) {}

  // Hourly at minute 20, after the recurring sweep at :05, so Monday's digest
  // includes that morning's bookings. waitForCompletion makes the scheduler
  // itself skip ticks while a run is in flight; the running flag covers the
  // same ground for any direct caller of run().
  @Cron('20 * * * *', { waitForCompletion: true })
  async poll(): Promise<void> {
    await this.run(new Date());
  }

  async run(now: Date): Promise<void> {
    if (this.running) {
      this.logger.warn('Report run skipped: previous run still in flight');
      return;
    }
    this.running = true;
    const tally: Record<Outcome, number> = { sent: 0, skipped: 0, failed: 0 };
    try {
      for (const period of latestPeriods(now)) {
        let outcome: Outcome | 'not-configured' | 'idle';
        try {
          outcome = await this.handle(period, now);
        } catch (err) {
          // A database error on one report must say which report it was, and
          // must not stop the other from going out this hour.
          this.logger.error(`${period.kind} report ${period.key} failed`, err instanceof Error ? err.stack : String(err));
          outcome = 'failed';
        }
        if (outcome === 'not-configured') break;
        if (outcome !== 'idle') tally[outcome]++;
      }
      if (tally.sent + tally.skipped + tally.failed > 0) {
        this.logger.log(`Report run: sent ${tally.sent}, skipped ${tally.skipped}, failed ${tally.failed}`);
      }
    } catch (err) {
      this.logger.error('Report run failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async handle(period: ReportPeriod, now: Date): Promise<Outcome | 'not-configured' | 'idle'> {
    const key = { kind: period.kind, period: period.key };
    const existing = await this.sendModel.findOne(key).lean();

    if (existing) {
      if (existing.status !== 'sending') return 'idle'; // sent or skipped: final
      // A claim this old belongs to a pod that died mid-send. Take it over
      // atomically, so only one pod does; past the window, close it instead.
      const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
      const takenOver = await this.sendModel.findOneAndUpdate(
        { ...key, status: 'sending', at: { $lt: staleBefore } },
        { $set: period.expired ? { status: 'skipped', at: now } : { at: now } },
      );
      if (!takenOver) return 'idle'; // another pod is sending it right now
      return period.expired ? this.logSkipped(period) : this.send(period, now);
    }

    if (period.expired) {
      try {
        await this.sendModel.create({ ...key, status: 'skipped', at: now });
      } catch (err: any) {
        if (err?.code === 11000) return 'idle';
        throw err;
      }
      return this.logSkipped(period);
    }

    if (!this.mailer.isConfigured()) {
      this.logger.warn('Reports not sent: GMAIL_USER / GMAIL_APP_PASSWORD are not set');
      return 'not-configured';
    }

    try {
      await this.sendModel.create({ ...key, status: 'sending', at: now });
    } catch (err: any) {
      if (err?.code === 11000) return 'idle'; // another pod claimed it first
      throw err;
    }
    return this.send(period, now);
  }

  private logSkipped(period: ReportPeriod): Outcome {
    const days = period.kind === 'weekly' ? WEEKLY_WINDOW_DAYS : MONTHLY_WINDOW_DAYS;
    this.logger.warn(`Not sending ${period.kind} report ${period.key}: more than ${days} days past due`);
    return 'skipped';
  }

  private async send(period: ReportPeriod, now: Date): Promise<Outcome> {
    const key = { kind: period.kind, period: period.key };
    try {
      const options = { webUrl: dashboardUrl() };
      const email =
        period.kind === 'weekly'
          ? renderWeekly(await this.data.weekly(period, now), options)
          : renderMonthly(await this.data.monthly(period), options);
      await this.mailer.send(email);
    } catch (err) {
      this.logger.error(
        `Sending ${period.kind} report ${period.key} failed; retrying next hour`,
        err instanceof Error ? err.stack : String(err),
      );
      // Only this run's claim: if a slow send let another pod take the claim
      // over, that pod's claim is not ours to release.
      try {
        await this.sendModel.deleteOne({ ...key, status: 'sending', at: now });
      } catch (releaseErr) {
        // The claim stays; once it is stale a later run takes it over.
        this.logger.error(`Could not release the claim on ${period.kind} report ${period.key}`, String(releaseErr));
      }
      return 'failed';
    }

    try {
      await this.sendModel.updateOne(key, { $set: { status: 'sent', at: now } });
    } catch (err) {
      // The email went out. The claim stays 'sending', so once it is stale
      // another run may send it again: a duplicate, never a loss.
      this.logger.error(`Sent ${period.kind} report ${period.key} but could not record it; it may be sent again`, String(err));
    }
    return 'sent';
  }
}
