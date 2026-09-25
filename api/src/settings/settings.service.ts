import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings } from '../shared/schemas/settings.schema';
import { ReportSend } from '../shared/schemas/report-send.schema';

export type SettingSource = 'saved' | 'config';
export interface SettingValue<T> {
  value: T;
  source: SettingSource;
}
export interface LastSent {
  period: string;
  at: Date;
}
export interface SettingsView {
  reports: {
    weekly: SettingValue<boolean>;
    monthly: SettingValue<boolean>;
    recipient: SettingValue<string | null>;
    lastSent: { weekly: LastSent | null; monthly: LastSent | null };
  };
  accounts: { cash: SettingValue<string[]>; senders: SettingValue<string[]> };
}
export interface ReportsInput {
  weekly?: unknown;
  monthly?: unknown;
  recipient?: unknown;
}
export interface AccountsInput {
  cash?: unknown;
  senders?: unknown;
}

type SavedSettings = Pick<Settings, 'reports' | 'accounts'> | null;

const MAX_ENTRIES = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a, b,, c " → ['a', 'b', 'c']: the environment variables' list format. */
export function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The one reader of the user's settings. A field saved on the Settings page
 * wins; a field never saved falls back to the server's environment variable,
 * so nothing changes until the user saves.
 */
@Injectable()
export class SettingsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Settings.name) private readonly model: Model<Settings>,
    @InjectModel(ReportSend.name) private readonly sendModel: Model<ReportSend>,
  ) {}

  /** The ingester's account lists, resolved. */
  async accounts(): Promise<{ cash: string[]; senders: string[] }> {
    const a = this.resolveAccounts(await this.load());
    return { cash: a.cash.value, senders: a.senders.value };
  }

  /** The report scheduler's switches and recipient, resolved. */
  async reports(): Promise<{ weekly: boolean; monthly: boolean; recipient: string | null }> {
    const r = this.resolveReports(await this.load());
    return { weekly: r.weekly.value, monthly: r.monthly.value, recipient: r.recipient.value };
  }

  /** Everything the Settings page shows, with where each value came from. */
  async view(): Promise<SettingsView> {
    const [doc, weekly, monthly] = await Promise.all([this.load(), this.lastSent('weekly'), this.lastSent('monthly')]);
    return {
      reports: { ...this.resolveReports(doc), lastSent: { weekly, monthly } },
      accounts: this.resolveAccounts(doc),
    };
  }

  async saveReports(input: ReportsInput): Promise<SettingsView> {
    if (typeof input?.weekly !== 'boolean' || typeof input?.monthly !== 'boolean') {
      throw new BadRequestException('weekly and monthly must be true or false');
    }
    const recipient = this.parseRecipient(input.recipient);
    await this.model.updateOne(
      { userId: this.userId },
      { $set: { reports: { weekly: input.weekly, monthly: input.monthly, recipient } } },
      { upsert: true },
    );
    return this.view();
  }

  async saveAccounts(input: AccountsInput): Promise<SettingsView> {
    const cash = this.parseList(input?.cash, 'cash accounts', (v) => (/^\d{4}$/.test(v) ? null : `${v} is not 4 digits`));
    const senders = this.parseList(input?.senders, 'sender identifiers', (v) =>
      v.length < 3
        ? `${v} is too short: use at least 3 characters`
        : v.length > 40
          ? `${v.slice(0, 40)}… is longer than 40 characters`
          : null,
    );
    await this.model.updateOne({ userId: this.userId }, { $set: { accounts: { cash, senders } } }, { upsert: true });
    return this.view();
  }

  /** Forgets the saved reports section: it follows the server's config (env) again. */
  async resetReports(): Promise<SettingsView> {
    await this.model.updateOne({ userId: this.userId }, { $unset: { reports: '' } });
    return this.view();
  }

  /** Forgets the saved accounts section: it follows the server's config (env) again. */
  async resetAccounts(): Promise<SettingsView> {
    await this.model.updateOne({ userId: this.userId }, { $unset: { accounts: '' } });
    return this.view();
  }

  private load(): Promise<SavedSettings> {
    return this.model.findOne({ userId: this.userId }).lean() as unknown as Promise<SavedSettings>;
  }

  private resolveReports(doc: SavedSettings) {
    const saved = doc?.reports;
    const configRecipient = process.env.REPORT_TO?.trim() || process.env.GMAIL_USER?.trim() || null;
    const flag = (v: unknown): SettingValue<boolean> =>
      typeof v === 'boolean' ? { value: v, source: 'saved' } : { value: true, source: 'config' };
    return {
      weekly: flag(saved?.weekly),
      monthly: flag(saved?.monthly),
      recipient: (saved?.recipient
        ? { value: saved.recipient, source: 'saved' }
        : { value: configRecipient, source: 'config' }) as SettingValue<string | null>,
    };
  }

  private resolveAccounts(doc: SavedSettings) {
    const saved = doc?.accounts;
    const list = (v: unknown, env: string | undefined): SettingValue<string[]> =>
      Array.isArray(v) ? { value: v as string[], source: 'saved' } : { value: splitList(env), source: 'config' };
    return {
      cash: list(saved?.cash, process.env.OWN_CASH_ACCOUNTS),
      senders: list(saved?.senders, process.env.OWN_ACCOUNT_IDENTIFIERS),
    };
  }

  private async lastSent(kind: 'weekly' | 'monthly'): Promise<LastSent | null> {
    const row = await this.sendModel.findOne({ kind, status: 'sent' }).sort({ at: -1 }).lean();
    return row ? { period: row.period, at: row.at } : null;
  }

  private parseRecipient(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') throw new BadRequestException('recipient must be an email address');
    const v = raw.trim();
    if (!v) return null;
    if (v.length > 254 || !EMAIL.test(v)) throw new BadRequestException(`${v.slice(0, 60)} is not an email address`);
    return v;
  }

  private parseList(raw: unknown, what: string, problem: (v: string) => string | null): string[] {
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      throw new BadRequestException(`${what} must be a list of text`);
    }
    const values = (raw as string[]).map((v) => v.trim());
    if (values.length > MAX_ENTRIES) throw new BadRequestException(`at most ${MAX_ENTRIES} ${what}`);
    const seen = new Set<string>();
    for (const v of values) {
      const p = problem(v);
      if (p) throw new BadRequestException(p);
      const key = v.toLowerCase();
      if (seen.has(key)) throw new BadRequestException(`${v} is listed twice`);
      seen.add(key);
    }
    return values;
  }
}
