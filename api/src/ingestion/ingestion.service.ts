import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Category } from '../shared/schemas/category.enum';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { Recurring } from '../shared/schemas/recurring.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NOT_DELETED, isNonSpendingTransfer } from '../shared/schemas/transfer-kind';
import { parseConfiguredInstant } from '../shared/time-zone';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';
import { BankParser, ParsedTransaction } from './parsers/types';
import { popularParser } from './parsers/popular.parser';
import { bhdParser } from './parsers/bhd.parser';
import { santaCruzParser } from './parsers/santacruz.parser';
import { banreservasParser } from './parsers/banreservas.parser';
import { matchedPeriod, RuleLike } from './reconciliation.service';
import { SettingsService } from '../settings/settings.service';
import { IngestionStatusService, RunCounts } from './ingestion-status.service';
import { MerchantMemoryService } from '../merchants/merchant-memory.service';
import { merchantKey } from '../merchants/merchant-key';

/** Per-run state shared by every mail: loaded once, never once per mail. */
interface RunContext {
  /** Category names the categoriser may choose from: built-ins plus the user's active custom ones. */
  allowed: string[];
  /** The user's active recurring rules. */
  rules: RuleLike[];
  /** Bank merchants the user already categorized: merchantKey → category. */
  remembered: Map<string, string>;
}

/** How far apart the two legs of one internal transfer may be reported by their banks. */
const LEG_WINDOW_MS = 24 * 3600_000;

/** How far before the last good run the next one starts reading: covers late delivery and clock skew. */
const RESUME_OVERLAP_MS = 2 * 24 * 3600_000;

/** The Settings page's reason for a mail refused under MAIL_VERIFY=enforce. */
const UNVERIFIED_REASON = "Couldn't verify it came from the bank";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private readonly parsers: BankParser[] = [popularParser, bhdParser, santaCruzParser, banreservasParser];

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    private readonly ledger: LedgerService,
    private readonly categories: CategoriesService,
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    private readonly mail: MailClient,
    private readonly categorizer: CategorizerService,
    private readonly fx: FxService,
    private readonly settings: SettingsService,
    private readonly status: IngestionStatusService,
    private readonly memory: MerchantMemoryService,
  ) {}

  /** Set while a run is in flight so a slow run is never overlapped by the next tick. */
  private running = false;

  // waitForCompletion makes the scheduler itself skip ticks while a run is in
  // flight; the flag covers the same ground for any direct caller of poll().
  @Cron(process.env.INGEST_POLL_CRON || '*/10 * * * *', { waitForCompletion: true })
  async poll(): Promise<void> {
    try {
      await this.runGuarded();
    } catch {
      // runGuarded has already logged the failure and recorded it for the Settings page.
    }
  }

  /** True while this pod has a run in flight. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * One run, unless one is already in flight (then null). The outcome is
   * recorded for the Settings page; a run that fails as a whole is logged,
   * recorded and rethrown.
   */
  async runGuarded(): Promise<RunCounts | null> {
    if (this.running) {
      this.logger.warn('Ingestion poll skipped: previous run still in flight');
      return null;
    }
    this.running = true;
    try {
      const counts = await this.run();
      await this.status.recordRun(counts);
      return counts;
    } catch (err) {
      this.logger.error('Ingestion poll failed', err instanceof Error ? err.stack : String(err));
      await this.status.recordFailure(err);
      throw err;
    } finally {
      this.running = false;
    }
  }

  async run(now: Date = new Date()): Promise<RunCounts> {
    const since = await this.watermark(now);
    const senders = this.parsers.flatMap((p) => p.senders);
    // The configured-start business rule (historical mail is never booked) is
    // separate from the moving window: passed to MailClient so it can judge
    // each mail's own claimed date, while `since` judges arrival.
    const configuredStart = parseConfiguredInstant(process.env.INGEST_START_AT);
    const mails = await this.mail.fetchSince(since, senders, configuredStart);

    // GMAIL_USER / GMAIL_APP_PASSWORD unset — the documented way to pause
    // ingestion. A run that never opened the mailbox must not forget
    // unreadable mail or move the resume point: either would silently
    // narrow the window while paused, so mail from before it resumed would
    // be skipped for good once credentials come back.
    if (mails === null) {
      return { created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 };
    }

    // Mails before the configured start can't come back: don't leave them on
    // the unreadable list. Only the configured start, never the moving window:
    // an unreadable mail inside the window holds the window open until it
    // books or is dismissed (see updateResumePoint).
    if (configuredStart) {
      await this.status.forgetUnreadableBefore(configuredStart);
    }

    // Dedupe BEFORE any work. Every poll re-reads its whole window (at least
    // the last two days); without this, each poll re-ran FX, categorisation
    // (a model call per unknown merchant) and the rule lookups for every
    // historical mail, only to hit the unique index.
    const known = await this.alreadyIngested(mails.map((m) => m.messageId));
    // Mails the user marked "Not a transaction" on the Settings page.
    const dismissed = await this.status.dismissedAmong(mails.map((m) => m.messageId));
    // A listed mail whose clear failed once is skipped below as already booked: clear it here.
    await this.status.clearUnreadableMany(mails.map((m) => m.messageId).filter((id) => known.has(id)));
    const ctx = await this.loadRunContext();

    const counts: RunCounts = { created: 0, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 };
    const enforce = process.env.MAIL_VERIFY === 'enforce';
    let oldestFailed: Date | null = null;
    // Saved on the Settings page, else the server's config (see SettingsService).
    const { cash: ownCashAccounts, senders: ownIdentifiers } = await this.settings.accounts();

    for (const mail of mails) {
      if (!mail.verified) {
        counts.unverified++;
        this.logger.warn(`Unverified mail from ${mail.sender} (${mail.messageId}): Gmail's checks didn't pass for its domain`);
      }

      if (known.has(mail.messageId)) { counts.alreadyBooked++; continue; }
      if (dismissed.has(mail.messageId)) { counts.notTransactions++; continue; }

      // MAIL_VERIFY=enforce: a forged "bank alert" must not book. Listed on
      // Settings with the reason, so a real one can still be seen and dismissed.
      if (enforce && !mail.verified) {
        await this.status.recordUnreadable({ ...mail, reason: UNVERIFIED_REASON });
        counts.unreadable++;
        continue;
      }

      const parser = this.parsers.find((p) => p.senders.includes(mail.sender));
      if (!parser) { counts.notTransactions++; continue; }

      // Recognised and deliberately ignored — not a failure, so it must not
      // reach the "unusable mail" warning below. Payroll notices arrive monthly
      // and marketing more often; logging them as failures would bury the real
      // failures under routine noise.
      if (parser.isNonTransactional?.({ subject: mail.subject, body: mail.body })) {
        counts.notTransactions++;
        await this.status.clearUnreadable(mail.messageId);
        continue;
      }

      let parsed: ParsedTransaction | null = null;
      try {
        parsed = parser.parse({ subject: mail.subject, body: mail.body, ownIdentifiers, ownCashAccounts });
      } catch (err) {
        this.logger.error(`Parser ${parser.bank} threw on ${mail.messageId}`, String(err));
      }

      if (!parsed) {
        // Never silently drop: an allow-listed sender we could not use is worth seeing.
        this.logger.warn(`Unusable mail from ${mail.sender} (${mail.messageId}) subject="${mail.subject}"`);
        await this.status.recordUnreadable(mail);
        counts.unreadable++;
        continue;
      }

      const result = await this.persist(parsed, mail.messageId, ctx);
      if (result === 'created' || result === 'duplicate') await this.status.clearUnreadable(mail.messageId);
      if (result === 'created') counts.created++;
      else if (result === 'duplicate') counts.alreadyBooked++;
      else {
        counts.bookingFailed++;
        // arrivedAt, not receivedAt: the resume point must not react to a
        // sender's forgeable (or simply stale) Date header.
        if (!oldestFailed || mail.arrivedAt < oldestFailed) oldestFailed = mail.arrivedAt;
      }
    }

    this.logger.log(
      `Ingestion run: created=${counts.created} alreadyBooked=${counts.alreadyBooked} ` +
        `notTransactions=${counts.notTransactions} unreadable=${counts.unreadable} bookingFailed=${counts.bookingFailed} ` +
        `unverified=${counts.unverified}`,
    );
    await this.updateResumePoint(now, oldestFailed, configuredStart);
    return counts;
  }

  /** Forward-only: never before the configured start; see IngestionStatusService.windowStart. */
  private async watermark(now: Date): Promise<Date> {
    return (await this.status.windowStart()) ?? new Date(now.getTime() - 24 * 3600_000);
  }

  /**
   * Where the next run starts: this run's start (every mail delivered before
   * it has been read), pulled back to the oldest mail still waiting (a
   * booking that failed, or an unreadable mail not dismissed), less two days.
   * Measured from the run's start, not the newest mail's, so a quiet inbox
   * doesn't widen the window and an empty run doesn't slide it back. If the
   * waiting list can't be read, the point stays where it was. Tagged with
   * `configuredStart` so a later change to INGEST_START_AT is noticed instead
   * of being shadowed by this point forever (see IngestionStatusService.windowStart).
   */
  private async updateResumePoint(runStart: Date, oldestFailed: Date | null, configuredStart: Date | null): Promise<void> {
    let oldestUnreadable: Date | null;
    try {
      oldestUnreadable = await this.status.oldestPendingUnreadable();
    } catch (err) {
      this.logger.error('Could not read the unreadable list; the resume point stays where it was', err instanceof Error ? err.stack : String(err));
      return;
    }
    const oldest = [runStart, oldestFailed, oldestUnreadable]
      .filter((d): d is Date => d !== null)
      .reduce((a, b) => (b < a ? b : a));
    await this.status.recordResumePoint(new Date(oldest.getTime() - RESUME_OVERLAP_MS), configuredStart);
  }

  /**
   * Message ids among `ids` that already have a transaction. Deliberately NOT
   * filtered on deletedAt: a soft-deleted email row keeps its sourceMessageId
   * precisely so the next poll cannot re-create it.
   */
  private async alreadyIngested(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.txModel
      .find({ sourceMessageId: { $in: ids } })
      .select('sourceMessageId')
      .lean();
    return new Set(rows.map((r) => r.sourceMessageId).filter((id): id is string => Boolean(id)));
  }

  /** What every mail in one run needs; loaded once, not once per mail. */
  private async loadRunContext(): Promise<RunContext> {
    const rules = await this.recurringModel.find({ userId: this.userId, active: true }).lean();
    return {
      // cash is for ATM withdrawals only, which never reach the categorizer: never a guess for a merchant.
      allowed: (await this.categories.list()).map((c) => c.name).filter((name) => name !== Category.CASH),
      rules: rules as unknown as RuleLike[],
      remembered: await this.memory.all(),
    };
  }

  private async persist(
    p: ParsedTransaction,
    messageId: string,
    ctx: RunContext,
  ): Promise<'created' | 'duplicate' | 'failed'> {
    // Convert USD at ingest; keep the original for traceability.
    let amount = p.amount;
    let originalAmount: number | undefined;
    let originalCurrency: string | undefined;
    if (p.currency === 'USD') {
      originalAmount = p.amount;
      originalCurrency = 'USD';
      amount = await this.fx.usdToDop(p.amount);
    }

    const remembered = ctx.remembered.get(merchantKey(p.counterparty));
    const { category, needsReview } =
      p.direction === 'income'
        ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
        : p.isWithdrawal
          ? { category: Category.CASH, needsReview: false } // cash out of an ATM: itemized later on the web
          : remembered && ctx.allowed.includes(remembered)
            ? { category: remembered, needsReview: false } // the user already decided this merchant
            : await this.categorizer.categorize(p.counterparty, ctx.allowed);

    const signed = p.direction === 'expense' ? -Math.abs(amount) : Math.abs(amount);

    // An internal transfer reported by two banks arrives as two mails in
    // either order: the sending bank's leg (classified internal by its
    // destination account) and the receiving bank's leg (which names no
    // sender, so it cannot be classified on its own). Reconcile them here:
    // a received leg that finds its sent leg is internal, not income, and
    // both rows point at each other. Neither path moves the balance.
    let transferKind = p.transferKind;
    let counterLeg: { _id: unknown } | null = null;
    if (p.isReceivedTransfer || p.transferKind === 'internal') {
      counterLeg = await this.findCounterLeg(p, amount);
      if (counterLeg) transferKind = 'internal';
    }

    let recurringId: string | undefined;
    let recurringPeriod: string | undefined;

    let rule: RuleLike | undefined;
    let period: string | null = null;
    let predicted: any = null;
    let allMatchesClaimed = false;

    // Two active rules can share an amount and both have this mail's date in
    // range. Stopping at the first match unconditionally would, when that
    // rule's period is already satisfied by an earlier confirmed payment,
    // fall through to "record separately" — unlinked to ANY rule — leaving
    // the other rule's cron to fire later and double-charge it. So a rule
    // whose period is already claimed (a predicted row with a
    // sourceMessageId) is skipped in favour of the next matching rule; only
    // when every matching rule is already claimed do we fall through.
    for (const r of ctx.rules) {
      const matched = matchedPeriod(r, {
        userId: this.userId,
        amount: signed,
        timestamp: p.occurredAt,
        transferKind,
      });
      if (!matched) continue;

      const existing = await this.txModel.findOne({
        userId: this.userId,
        recurringId: String(r._id),
        recurringPeriod: matched,
        ...NOT_DELETED,
      });

      if (existing && existing.sourceMessageId) {
        allMatchesClaimed = true;
        continue;
      }

      rule = r;
      period = matched;
      predicted = existing;
      allMatchesClaimed = false;
      break;
    }

    if (rule && period) {
      if (predicted && !predicted.sourceMessageId) {
        // The cron fired first. Confirm the prediction in place: no second row,
        // and no second balance movement — the prediction already moved it.
        try {
          predicted.sourceMessageId = messageId;
          predicted.merchant = p.counterparty;
          predicted.externalRef = p.externalRef;
          predicted.timestamp = p.occurredAt;
          predicted.isWithdrawal = p.isWithdrawal;
          predicted.mailTimeLocal = true;
          await predicted.save();
        } catch (err: any) {
          if (err?.code === 11000) return 'duplicate';
          throw err;
        }
        this.logger.log(`Confirmed recurring ${String(rule._id)} from mail ${messageId}`);
        return 'created';
      }

      recurringId = String(rule._id);
      recurringPeriod = period;
      this.logger.log(`Linking mail ${messageId} to recurring rule ${String(rule._id)} for ${period}`);
    } else if (allMatchesClaimed) {
      // Every matching rule's period is already satisfied — a genuine second
      // payment of the same amount, not a duplicate. Record it normally, unlinked.
      this.logger.log(`All matching rules already satisfied for this period; recording ${messageId} separately`);
    }

    let doc: { _id: unknown };
    try {
      doc = await this.txModel.create({
        userId: this.userId,
        userName: 'email',
        transactionName: p.counterparty.toLowerCase(),
        // MUST go through the enum: its values are the legacy strings 'Доход'/'Расход'.
        transactionType:
          p.direction === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
        amount: signed,
        timestamp: p.occurredAt,
        category,
        categoryNeedsReview: needsReview,
        sourceMessageId: messageId,
        source: 'email',
        merchant: p.counterparty,
        cardLast4: p.cardLast4,
        originalAmount,
        originalCurrency,
        isWithdrawal: p.isWithdrawal,
        mailTimeLocal: true,
        externalRef: p.externalRef,
        transferKind,
        matchedLegId: counterLeg ? String(counterLeg._id) : undefined,
        recurringId,
        recurringPeriod,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        // Unique index on sourceMessageId — already ingested. Expected, not an error.
        return 'duplicate';
      }
      this.logger.error(`Failed to persist ${messageId}`, err instanceof Error ? err.stack : String(err));
      return 'failed';
    }

    // Every step after the create is a side effect the row depends on. If one
    // fails, the row must not survive it: its unique sourceMessageId would
    // make every later poll report 'duplicate', and the side effect would
    // never be retried — a permanent balance drift. Delete the row so the
    // next poll redoes the whole thing.
    try {
      if (counterLeg) {
        // Only an unresolved leg may be flipped to internal; a resolved one
        // already moved the balance. This only applies when the counter leg is
        // the received (unresolved) half — a matched sent leg is already
        // internal and was never a resolution target.
        const link = await this.txModel.updateOne(
          p.isReceivedTransfer
            ? { _id: counterLeg._id }
            : { _id: counterLeg._id, transferKind: 'unresolved', ...NOT_DELETED },
          { $set: { transferKind: 'internal', matchedLegId: String(doc._id) } },
        );
        if (!p.isReceivedTransfer && link.matchedCount === 0) {
          // Between findCounterLeg's read and this write, the received leg was
          // resolved by a concurrent request — it is no longer part of this
          // transfer. Undo the optimistic matchedLegId this row was created
          // with, rather than leave it pointing at a leg that is not internal.
          this.logger.warn(`Counter leg ${String(counterLeg._id)} no longer unresolved; recording ${messageId} unlinked`);
          await this.txModel.updateOne({ _id: doc._id }, { $unset: { matchedLegId: 1 } });
        } else {
          this.logger.log(`Matched transfer legs ${String(counterLeg._id)} <-> ${String(doc._id)} from mail ${messageId}`);
        }
      }
      // Only external transfers and ordinary card transactions move money.
      // An internal transfer nets to zero against the single Balance document,
      // and an unresolved one has not been asserted yet.
      if (isNonSpendingTransfer(transferKind)) {
        return 'created';
      }
      await this.ledger.apply(signed, p.direction, p.counterparty, String(doc._id));
      return 'created';
    } catch (err) {
      this.logger.error(
        `Post-create step failed for ${messageId}; rolling back row ${String(doc._id)}`,
        err instanceof Error ? err.stack : String(err),
      );
      try {
        await this.txModel.deleteOne({ _id: doc._id });
      } catch (rollbackErr) {
        this.logger.error(`Rollback of ${String(doc._id)} failed; row is orphaned`, String(rollbackErr));
      }
      return 'failed';
    }
  }

  /**
   * The other half of a two-bank internal transfer, if it has already been
   * ingested and not yet claimed. For a received leg that is a sent leg
   * classified internal (only those — a genuine external payment of the
   * same amount is a coincidence); for a sent leg it is a still-unresolved
   * received leg. Either way: same magnitude, opposite sign, within a day.
   */
  private async findCounterLeg(p: ParsedTransaction, amount: number): Promise<{ _id: unknown } | null> {
    const t = p.occurredAt.getTime();
    const magnitude = Math.abs(amount);
    const leg = p.isReceivedTransfer
      ? { transferKind: 'internal', amount: -magnitude }
      : { transferKind: 'unresolved', amount: magnitude };
    return this.txModel.findOne({
      userId: this.userId,
      source: 'email',
      ...leg,
      timestamp: { $gte: new Date(t - LEG_WINDOW_MS), $lte: new Date(t + LEG_WINDOW_MS) },
      matchedLegId: { $exists: false },
      ...NOT_DELETED,
    });
  }
}
