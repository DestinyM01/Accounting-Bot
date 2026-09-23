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
import { matchedPeriod } from './reconciliation.service';

const BUILT_IN = ['food','transport','housing','health','entertainment','salary','savings','other'];

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

  @Cron(process.env.INGEST_POLL_CRON || '*/10 * * * *')
  async poll(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error('Ingestion poll failed', err instanceof Error ? err.stack : String(err));
    }
  }

  async run(): Promise<{ created: number; skipped: number; failed: number }> {
    const since = this.watermark();
    const senders = this.parsers.flatMap((p) => p.senders);
    const mails = await this.mail.fetchSince(since, senders);

    let created = 0, skipped = 0, failed = 0;
    const ownIdentifiers = (process.env.OWN_ACCOUNT_IDENTIFIERS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ownCashAccounts = (process.env.OWN_CASH_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);

    for (const mail of mails) {
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

      const result = await this.persist(parsed, mail.messageId);
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

  private async persist(p: ParsedTransaction, messageId: string): Promise<'created' | 'duplicate' | 'failed'> {
    // Convert USD at ingest; keep the original for traceability.
    let amount = p.amount;
    let originalAmount: number | undefined;
    let originalCurrency: string | undefined;
    if (p.currency === 'USD') {
      originalAmount = p.amount;
      originalCurrency = 'USD';
      amount = await this.fx.usdToDop(p.amount);
    }

    const custom = await this.categoryModel.find({ userId: this.userId, active: true }).lean();
    const allowed = [...BUILT_IN, ...custom.map((c) => c.name)];

    const { category, needsReview } =
      p.direction === 'income'
        ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
        : await this.categorizer.categorize(p.counterparty, allowed);

    const signed = p.direction === 'expense' ? -Math.abs(amount) : Math.abs(amount);

    let recurringId: string | undefined;
    let recurringPeriod: string | undefined;

    const rules = await this.recurringModel.find({ userId: this.userId, active: true }).lean();
    let rule: (typeof rules)[number] | undefined;
    let period: string | null = null;
    for (const r of rules) {
      const matched = matchedPeriod(r as any, {
        userId: this.userId,
        amount: signed,
        timestamp: p.occurredAt,
        transferKind: p.transferKind,
      });
      if (matched) {
        rule = r;
        period = matched;
        break;
      }
    }

    if (rule && period) {
      const predicted = await this.txModel.findOne({
        userId: this.userId,
        recurringId: String(rule._id),
        recurringPeriod: period,
      });

      if (predicted && !predicted.sourceMessageId) {
        // The cron fired first. Confirm the prediction in place: no second row,
        // and no second balance movement — the prediction already moved it.
        try {
          predicted.sourceMessageId = messageId;
          predicted.merchant = p.counterparty;
          predicted.externalRef = p.externalRef;
          predicted.timestamp = p.occurredAt;
          if (!predicted.recurringPeriod) predicted.recurringPeriod = period;
          await predicted.save();
        } catch (err: any) {
          if (err?.code === 11000) return 'duplicate';
          throw err;
        }
        this.logger.log(`Confirmed recurring ${String(rule._id)} from mail ${messageId}`);
        return 'created';
      }

      if (predicted) {
        // Already reconciled this period — a genuine second payment of the same
        // amount, not a duplicate. Record it normally, unlinked.
        this.logger.log(
          `Rule ${String(rule._id)} already matched for ${period}; recording ${messageId} separately`,
        );
      } else {
        recurringId = String(rule._id);
        recurringPeriod = period;
        this.logger.log(`Linking mail ${messageId} to recurring rule ${String(rule._id)} for ${period}`);
      }
    }

    try {
      const doc = await this.txModel.create({
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
        transferKind: p.transferKind,
        recurringId,
        recurringPeriod,
      });
      // Only external transfers and ordinary card transactions move money.
      // An internal transfer nets to zero against the single Balance document,
      // and an unresolved one has not been asserted yet.
      if (p.transferKind === 'internal' || p.transferKind === 'unresolved') {
        return 'created';
      }
      await this.applyBalance(p, amount, String(doc._id));
      return 'created';
    } catch (err: any) {
      if (err?.code === 11000) {
        // Unique index on sourceMessageId — already ingested. Expected, not an error.
        return 'duplicate';
      }
      this.logger.error(`Failed to persist ${messageId}`, err instanceof Error ? err.stack : String(err));
      return 'failed';
    }
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
