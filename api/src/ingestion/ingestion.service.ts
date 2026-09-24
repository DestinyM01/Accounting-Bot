import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Balance } from '../shared/schemas/balance.schema';
import { BalanceHistory } from '../shared/schemas/balance-history.schema';
import { CustomCategory } from '../shared/schemas/custom-category.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { MailClient } from './mail.client';
import { CategorizerService } from './categorizer.service';
import { FxService } from './fx.service';
import { BankParser, ParsedTransaction } from './parsers/types';
import { popularParser } from './parsers/popular.parser';
import { bhdParser } from './parsers/bhd.parser';
import { santaCruzParser } from './parsers/santacruz.parser';
import { banreservasParser } from './parsers/banreservas.parser';
import { matchedPeriod, RuleLike } from './reconciliation.service';

const BUILT_IN = ['food','transport','housing','health','entertainment','salary','savings','other'];

/** Per-run state shared by every mail: loaded once, never once per mail. */
interface RunContext {
  /** Category names the categoriser may choose from: built-ins plus the user's active custom ones. */
  allowed: string[];
  /** The user's active recurring rules. */
  rules: RuleLike[];
}

/** How far apart the two legs of one internal transfer may be reported by their banks. */
const LEG_WINDOW_MS = 24 * 3600_000;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private readonly parsers: BankParser[] = [popularParser, bhdParser, santaCruzParser, banreservasParser];

  constructor(
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private readonly historyModel: Model<BalanceHistory>,
    @InjectModel(CustomCategory.name) private readonly categoryModel: Model<CustomCategory>,
    @InjectModel(Recurring.name) private readonly recurringModel: Model<Recurring>,
    private readonly mail: MailClient,
    private readonly categorizer: CategorizerService,
    private readonly fx: FxService,
  ) {}

  /** Set while a run is in flight so a slow run is never overlapped by the next tick. */
  private running = false;

  // waitForCompletion makes the scheduler itself skip ticks while a run is in
  // flight; the flag covers the same ground for any direct caller of poll().
  @Cron(process.env.INGEST_POLL_CRON || '*/10 * * * *', { waitForCompletion: true })
  async poll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Ingestion poll skipped: previous run still in flight');
      return;
    }
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error('Ingestion poll failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<{ created: number; skipped: number; failed: number }> {
    const since = this.watermark();
    const senders = this.parsers.flatMap((p) => p.senders);
    const mails = await this.mail.fetchSince(since, senders);

    // Dedupe BEFORE any work. The watermark never advances, so every poll
    // re-fetches every mail since the start date; without this, each poll
    // re-ran FX, categorisation (a model call per unknown merchant) and the
    // rule lookups for every historical mail, only to hit the unique index.
    const known = await this.alreadyIngested(mails.map((m) => m.messageId));
    const ctx = await this.loadRunContext();

    let created = 0, skipped = 0, failed = 0;
    const ownIdentifiers = (process.env.OWN_ACCOUNT_IDENTIFIERS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ownCashAccounts = (process.env.OWN_CASH_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);

    for (const mail of mails) {
      if (known.has(mail.messageId)) { skipped++; continue; }

      const parser = this.parsers.find((p) => p.senders.includes(mail.sender));
      if (!parser) { skipped++; continue; }

      // Recognised and deliberately ignored — not a failure, so it must not
      // reach the "unusable mail" warning below. Payroll notices arrive monthly
      // and marketing more often; logging them as failures would bury the real
      // failures under routine noise.
      if (parser.isNonTransactional?.({ subject: mail.subject, body: mail.body })) {
        skipped++;
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
        failed++;
        continue;
      }

      const result = await this.persist(parsed, mail.messageId, ctx);
      if (result === 'created') created++;
      else if (result === 'duplicate') skipped++;
      else failed++;
    }

    this.logger.log(`Ingestion run: created=${created} skipped=${skipped} failed=${failed}`);
    return { created, skipped, failed };
  }

  /** Forward-only: never ingest mail older than the configured start. */
  private watermark(): Date {
    const configured = process.env.INGEST_START_AT;
    const start = configured ? new Date(configured) : new Date(Date.now() - 24 * 3600_000);
    return isNaN(start.getTime()) ? new Date(Date.now() - 24 * 3600_000) : start;
  }

  /** Message ids among `ids` that already have a transaction. */
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
    const custom = await this.categoryModel.find({ userId: this.userId, active: true }).lean();
    const rules = await this.recurringModel.find({ userId: this.userId, active: true }).lean();
    return {
      allowed: [...BUILT_IN, ...custom.map((c) => c.name)],
      rules: rules as unknown as RuleLike[],
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

    const { category, needsReview } =
      p.direction === 'income'
        ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
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
        await this.txModel.updateOne(
          { _id: counterLeg._id },
          { $set: { transferKind: 'internal', matchedLegId: String(doc._id) } },
        );
        this.logger.log(`Matched transfer legs ${String(counterLeg._id)} <-> ${String(doc._id)} from mail ${messageId}`);
      }
      // Only external transfers and ordinary card transactions move money.
      // An internal transfer nets to zero against the single Balance document,
      // and an unresolved one has not been asserted yet.
      if (transferKind === 'internal' || transferKind === 'unresolved') {
        return 'created';
      }
      await this.applyBalance(p, amount, String(doc._id));
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
    });
  }

  private async applyBalance(p: ParsedTransaction, amount: number, txId: string): Promise<void> {
    const balance =
      (await this.balanceModel.findOne({ userId: this.userId })) ??
      (await this.balanceModel.create({ userId: this.userId, balance: 0 }));

    const previousBalance = balance.balance;
    balance.balance += p.direction === 'income' ? amount : -amount;
    balance.lastActivity = new Date();
    await balance.save();

    // Mirrors the bot: history failure must never break ingestion.
    try {
      await this.historyModel.create({
        userId: this.userId,
        previousBalance,
        newBalance: balance.balance,
        delta: balance.balance - previousBalance,
        reason: p.direction,
        transactionName: p.counterparty,
        transactionId: txId,
      });
    } catch (err) {
      this.logger.error('Failed to record balance history', String(err));
    }
  }
}
