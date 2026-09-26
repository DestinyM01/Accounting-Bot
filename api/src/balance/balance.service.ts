import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../shared/schemas/balance.schema';
import { BALANCE_CHANGE_REASONS, BalanceHistory } from '../shared/schemas/balance-history.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { dailyClosings, DailyPoint, windowStart } from './daily-closings';
import { afterTime, encodeTimeCursor, parseTimeCursor } from '../shared/cursor';

const MAX_ABS_BALANCE = 1e12;
const NOTE_MAX = 100;

export interface SetBalanceBody {
  balance: number;
  note?: string;
}

/** An integer query value, clamped; `fallback` when absent or not an integer. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

@Injectable()
export class BalanceService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private balanceModel: Model<Balance>,
    @InjectModel(BalanceHistory.name) private historyModel: Model<BalanceHistory>,
    private readonly ledger: LedgerService,
  ) {}

  async get() {
    return this.balanceModel
      .findOne({ userId: this.userId })
      .select('balance isPremium lastActivity language')
      .lean();
  }

  /** Sets the balance to the total the user's accounts show; recorded as a manual adjustment. */
  async set(body: SetBalanceBody) {
    const { balance, note } = body ?? ({} as SetBalanceBody);
    if (typeof balance !== 'number' || !Number.isFinite(balance) || Math.abs(balance) > MAX_ABS_BALANCE) {
      throw new BadRequestException(`balance must be a finite number within ±${MAX_ABS_BALANCE} (got ${balance})`);
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
      throw new BadRequestException('note must be a string');
    }
    const trimmed = typeof note === 'string' ? note.trim() : '';
    if (trimmed.length > NOTE_MAX) throw new BadRequestException(`note must be at most ${NOTE_MAX} characters`);

    return this.ledger.setTo(Math.round(balance * 100) / 100, trimmed || undefined);
  }

  async history(query: { limit?: string; offset?: string; reason?: string; before?: string }) {
    const limit = clampInt(query.limit, 20, 1, 100);
    const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const filter: Record<string, unknown> = { userId: this.userId };
    if (query.reason !== undefined && query.reason !== '') {
      if (!(BALANCE_CHANGE_REASONS as readonly string[]).includes(query.reason)) {
        throw new BadRequestException(`reason must be one of ${BALANCE_CHANGE_REASONS.join(', ')}`);
      }
      filter.reason = query.reason;
    }

    // Rows with seq (every change since it existed) come first, newest first; older
    // rows have no seq and follow, by time. The cursor encodes which kind it stopped on.
    // The cursor clause is layered onto a copy, `pageFilter` — never `filter`
    // itself — so the total below, counted against `filter` alone, stays
    // stable while paging (the same split Transactions uses).
    let pageFilter: Record<string, unknown> = filter;
    if (query.before !== undefined && query.before !== '') {
      const raw = query.before;
      if (/^s\d+$/.test(raw)) {
        pageFilter = { ...filter, $or: [{ seq: { $lt: Number(raw.slice(1)) } }, { seq: { $exists: false } }] };
      } else if (raw.startsWith('t') && parseTimeCursor(raw.slice(1))) {
        pageFilter = { ...filter, seq: { $exists: false }, ...afterTime(parseTimeCursor(raw.slice(1))!) };
      } else {
        throw new BadRequestException('before must be a cursor from a previous page');
      }
    }

    const find = this.historyModel.find(pageFilter).sort({ seq: -1, timestamp: -1, _id: -1 });
    const [rows, total] = await Promise.all([
      (query.before ? find : find.skip(offset)).limit(limit).lean(),
      this.historyModel.countDocuments(filter),
    ]);
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last
        ? last.seq != null ? `s${last.seq}` : `t${encodeTimeCursor(last.timestamp, last._id)}`
        : null;

    return {
      items: rows.map((r) => ({
        id: String(r._id),
        timestamp: r.timestamp,
        reason: r.reason,
        delta: r.delta,
        newBalance: r.newBalance,
        name: r.transactionName ?? null,
      })),
      total,
      nextCursor,
    };
  }

  /**
   * Daily closing balances for the chart, drawn from history only. The live
   * balance is used only when there is no history at all (a flat line).
   */
  async daily(query: { days?: string }, now: Date = new Date()): Promise<DailyPoint[]> {
    const days = clampInt(query.days, 90, 7, 365);
    const start = windowStart(now, days);

    const [before, rows] = await Promise.all([
      this.historyModel
        .findOne({ userId: this.userId, timestamp: { $lt: start } })
        .sort({ timestamp: -1, seq: -1, _id: -1 })
        .select('newBalance')
        .lean(),
      this.historyModel
        .find({ userId: this.userId, timestamp: { $gte: start } })
        .sort({ timestamp: 1, seq: 1, _id: 1 })
        .select('timestamp newBalance previousBalance')
        .lean(),
    ]);

    let opening: number;
    if (before) opening = before.newBalance;
    else if (rows.length > 0) opening = rows[0].previousBalance;
    else opening = (await this.balanceModel.findOne({ userId: this.userId }).select('balance').lean())?.balance ?? 0;

    return dailyClosings({ windowStart: start, days, opening, rows });
  }
}
