# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web Settings page that:
- shows bank-mail ingestion status and lets you run a check or dismiss an unreadable mail;
- controls the emailed reports;
- edits the user's own-account identifiers.

**Architecture:**
- **One settings store.** A `Settings` document, read only through `SettingsService`, which falls back to today's environment variables for any field never saved.
- **Ingestion records its runs and unreadable mails** through a new `IngestionStatusService`, and an `IngestionController` exposes status, run and dismiss.
- **The report scheduler and the test endpoint** read the on/off switches and the recipient from Settings.
- **The web** gets a `/settings` page made of three self-contained section components.

**Tech Stack:**
- api: NestJS 10, Mongoose 8, Jest, pnpm.
- web: Angular 17 standalone, pnpm. It has no test runner, so it is verified by a clean build and no colour literals.

**Spec:** `docs/superpowers/specs/2026-09-24-settings-page-design.md`.

---

## Ground rules for every task

- **Paths.** Repo root: `C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot`. Use Git Bash, and `cd` with an absolute path in every command.
- **Branch.** Work on `main`; the user works trunk-based. **Never push, amend, rebase or reset.** Stage with `git add <explicit paths>` only.
- **Commits.** Every message ends with a blank line and exactly one trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo.** Test data is generic: `1111`, `SOME NAME`, `me@example.com`. No real account digits, names or addresses.
- **Baseline.** Before Task 1, the api has **46 suites / 500 tests**, all passing. Each task states the expected counts after it. If yours differ, report the exact numbers and why.
- **Best-effort writes.** Status writes (`IngestionStatusService`) never fail an ingestion run.
- **Web.** Theme tokens (`var(--…)`) only in stylesheets. The shared form classes `fc-field`, `fc-input`, `fc-btn`, `fc-btn--primary`, `fc-btn--ghost` and `fc-error` are global. `.cat-pill` and `.page-wrap` are global too.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/shared/schemas/settings.schema.ts` (+ spec) | create | the settings document |
| `api/src/shared/schemas/ingestion-status.schema.ts` (+ spec) | create | the last run and the last failed run |
| `api/src/shared/schemas/unreadable-mail.schema.ts` (+ spec) | create | mails the ingester couldn't read |
| `api/src/settings/settings.service.ts` (+ spec) | create | resolves settings with fallbacks; validates and saves sections |
| `api/src/settings/settings.controller.ts`, `settings.module.ts` | create | `/settings` routes |
| `api/src/ingestion/ingestion-status.service.ts` (+ spec) | create | status and unreadable-mail records, and the status view |
| `api/src/ingestion/ingestion.service.ts` (+ spec) | modify | accounts from Settings; dismissed skip; unreadable lifecycle; `runGuarded` |
| `api/src/ingestion/ingestion.controller.ts` (+ spec), `ingestion.module.ts` | create / modify | `/ingestion` routes |
| `api/src/reports/mailer.service.ts`, `report-scheduler.service.ts`, `reports.controller.ts`, `reports.module.ts` (+ specs) | modify | the on/off switches and the recipient from Settings |
| `api/src/app.module.ts`, `api/src/transactions/transactions.controller.spec.ts` | modify | wiring; guard table |
| `web/src/app/core/services/api.models.ts`, `api.service.ts` | modify | types and calls |
| `web/src/app/pages/settings/settings-section.scss` | create | styles shared by the three sections |
| `web/src/app/pages/settings/mail-section/*`, `reports-section/*`, `accounts-section/*` | create | one section each |
| `web/src/app/pages/settings/settings.component.*` | create | the page |
| `web/src/app/app.routes.ts`, `app.component.{ts,html}`, `pages/dashboard/*` | modify | route, nav, gear link; the test digest leaves the Dashboard |
| `README.md` | modify | the feature row and endpoints |

---

### Task 1: The three schemas

**Files:**
- Create: `api/src/shared/schemas/settings.schema.ts` and `settings.schema.spec.ts`
- Create: `api/src/shared/schemas/ingestion-status.schema.ts` and `ingestion-status.schema.spec.ts`
- Create: `api/src/shared/schemas/unreadable-mail.schema.ts` and `unreadable-mail.schema.spec.ts`

- [ ] **Step 1: Write the failing tests**

`settings.schema.spec.ts`:
```ts
import { SettingsSchema } from './settings.schema';

describe('SettingsSchema', () => {
  // One settings document per user: the database, not find-then-create code, guarantees it.
  it('declares a unique index on userId', () => {
    expect(SettingsSchema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
  });
});
```
`ingestion-status.schema.spec.ts`:
```ts
import { IngestionStatusSchema } from './ingestion-status.schema';

describe('IngestionStatusSchema', () => {
  it('declares a unique index on userId', () => {
    expect(IngestionStatusSchema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
  });
});
```
`unreadable-mail.schema.spec.ts`:
```ts
import { UnreadableMailSchema } from './unreadable-mail.schema';

describe('UnreadableMailSchema', () => {
  // A mail that fails every poll must stay one record whose attempts count up, never one record per poll.
  it('declares a unique index on (userId, messageId)', () => {
    expect(UnreadableMailSchema.indexes()).toContainEqual([
      { userId: 1, messageId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- schemas 2>&1 | tail -12
```
Expected: the three new specs fail to compile, because their modules don't exist yet.

- [ ] **Step 3: Implement**

`settings.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * What the user saved on the Settings page. Every field is optional: absent
 * means "use the server's environment variable" (see SettingsService). Each
 * section is replaced whole when saved.
 */
@Schema()
export class Settings extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ type: Object, default: undefined }) reports?: { weekly?: boolean; monthly?: boolean; recipient?: string | null };
  @Prop({ type: Object, default: undefined }) accounts?: { cash?: string[]; senders?: string[] };
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);

SettingsSchema.index({ userId: 1 }, { unique: true });
```
`ingestion-status.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** How the last ingestion run went, for the Settings page. One document per user. */
@Schema()
export class IngestionStatus extends Document {
  @Prop({ required: true }) userId: number;
  /** When the last run finished, and its counts. */
  @Prop() lastRunAt?: Date;
  @Prop() created?: number;
  @Prop() skipped?: number;
  @Prop() failed?: number;
  /** The last run that failed as a whole (e.g. IMAP login refused); null again after a successful run. */
  @Prop({ type: String, default: null }) lastError?: string | null;
  @Prop() lastErrorAt?: Date;
}

export const IngestionStatusSchema = SchemaFactory.createForClass(IngestionStatus);

IngestionStatusSchema.index({ userId: 1 }, { unique: true });
```
`unreadable-mail.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * A bank mail from a known sender that no parser could read. It is retried on
 * every poll until it books (and its record is deleted) or the user dismisses
 * it as not a transaction (and it is skipped from then on).
 */
@Schema()
export class UnreadableMail extends Document {
  @Prop({ required: true }) userId: number;
  @Prop({ required: true }) messageId: string;
  @Prop() sender: string;
  @Prop() subject: string;
  @Prop() receivedAt: Date;
  @Prop() firstSeenAt: Date;
  @Prop() lastSeenAt: Date;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: false }) dismissed: boolean;
}

export const UnreadableMailSchema = SchemaFactory.createForClass(UnreadableMail);

UnreadableMailSchema.index({ userId: 1, messageId: 1 }, { unique: true });
```

- [ ] **Step 4: Run the suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: **49 suites / 503 tests**, all passing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/shared/schemas/settings.schema.ts api/src/shared/schemas/settings.schema.spec.ts api/src/shared/schemas/ingestion-status.schema.ts api/src/shared/schemas/ingestion-status.schema.spec.ts api/src/shared/schemas/unreadable-mail.schema.ts api/src/shared/schemas/unreadable-mail.schema.spec.ts
git commit -F- <<'EOF'
feat(api): settings, ingestion status and unreadable-mail records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `SettingsService`: fallbacks, validation, saves

**Files:**
- Create: `api/src/settings/settings.service.ts`
- Test: `api/src/settings/settings.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`api/src/settings/settings.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Settings } from '../shared/schemas/settings.schema';
import { ReportSend } from '../shared/schemas/report-send.schema';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { sort: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const ENV_KEYS = ['REPORT_TO', 'GMAIL_USER', 'OWN_CASH_ACCOUNTS', 'OWN_ACCOUNT_IDENTIFIERS'];

describe('SettingsService', () => {
  let service: SettingsService;
  let model: { findOne: jest.Mock; updateOne: jest.Mock };
  let sendModel: { findOne: jest.Mock };
  const saved = (doc: unknown) => model.findOne.mockReturnValue(query(doc));

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    for (const k of ENV_KEYS) delete process.env[k];
    model = { findOne: jest.fn(() => query(null)), updateOne: jest.fn().mockResolvedValue({}) };
    sendModel = { findOne: jest.fn(() => query(null)) };
    const mod = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getModelToken(Settings.name), useValue: model },
        { provide: getModelToken(ReportSend.name), useValue: sendModel },
      ],
    }).compile();
    service = mod.get(SettingsService);
  });

  afterAll(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  describe('view', () => {
    it("falls back to the server's config for every field never saved", async () => {
      process.env.GMAIL_USER = 'me@example.com';
      process.env.OWN_CASH_ACCOUNTS = ' 1111, 2222,, ';
      process.env.OWN_ACCOUNT_IDENTIFIERS = '3333, SOME NAME ';
      expect(await service.view()).toEqual({
        reports: {
          weekly: { value: true, source: 'config' },
          monthly: { value: true, source: 'config' },
          recipient: { value: 'me@example.com', source: 'config' },
          lastSent: { weekly: null, monthly: null },
        },
        accounts: {
          cash: { value: ['1111', '2222'], source: 'config' },
          senders: { value: ['3333', 'SOME NAME'], source: 'config' },
        },
      });
      expect(model.findOne).toHaveBeenCalledWith({ userId: 1 });
    });

    it('prefers REPORT_TO to GMAIL_USER, and has no recipient without either', async () => {
      process.env.GMAIL_USER = 'me@example.com';
      process.env.REPORT_TO = 'other@example.com';
      expect((await service.view()).reports.recipient).toEqual({ value: 'other@example.com', source: 'config' });
      delete process.env.REPORT_TO;
      delete process.env.GMAIL_USER;
      expect((await service.view()).reports.recipient).toEqual({ value: null, source: 'config' });
    });

    it('uses every saved field, an empty list included', async () => {
      process.env.OWN_CASH_ACCOUNTS = '1111';
      saved({ reports: { weekly: false, monthly: true, recipient: 'x@example.com' }, accounts: { cash: [], senders: ['4444'] } });
      const v = await service.view();
      expect(v.reports.weekly).toEqual({ value: false, source: 'saved' });
      expect(v.reports.monthly).toEqual({ value: true, source: 'saved' });
      expect(v.reports.recipient).toEqual({ value: 'x@example.com', source: 'saved' });
      expect(v.accounts.cash).toEqual({ value: [], source: 'saved' });
      expect(v.accounts.senders).toEqual({ value: ['4444'], source: 'saved' });
    });

    it('falls back when the saved recipient was cleared', async () => {
      process.env.GMAIL_USER = 'me@example.com';
      saved({ reports: { weekly: true, monthly: true, recipient: null } });
      expect((await service.view()).reports.recipient).toEqual({ value: 'me@example.com', source: 'config' });
    });

    it('reports when each report was last sent', async () => {
      const at = new Date('2026-09-28T11:20:00Z');
      const weekly = query({ kind: 'weekly', period: '2026-W39', status: 'sent', at });
      sendModel.findOne.mockImplementation((filter: any) => (filter.kind === 'weekly' ? weekly : query(null)));
      expect((await service.view()).reports.lastSent).toEqual({ weekly: { period: '2026-W39', at }, monthly: null });
      expect(sendModel.findOne).toHaveBeenCalledWith({ kind: 'weekly', status: 'sent' });
      expect(sendModel.findOne).toHaveBeenCalledWith({ kind: 'monthly', status: 'sent' });
      expect(weekly.sort).toHaveBeenCalledWith({ at: -1 });
    });
  });

  it('gives the ingester and the scheduler plain resolved values', async () => {
    process.env.GMAIL_USER = 'me@example.com';
    saved({ accounts: { cash: ['1111'], senders: ['SOME NAME'] }, reports: { weekly: false, monthly: true, recipient: null } });
    expect(await service.accounts()).toEqual({ cash: ['1111'], senders: ['SOME NAME'] });
    expect(await service.reports()).toEqual({ weekly: false, monthly: true, recipient: 'me@example.com' });
  });

  describe('saveReports', () => {
    it('replaces the reports section in one upsert, trimming the recipient', async () => {
      await service.saveReports({ weekly: true, monthly: false, recipient: '  x@example.com ' });
      expect(model.updateOne).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { reports: { weekly: true, monthly: false, recipient: 'x@example.com' } } },
        { upsert: true },
      );
    });

    it('stores an empty or missing recipient as null, so it falls back', async () => {
      await service.saveReports({ weekly: true, monthly: true, recipient: '   ' });
      await service.saveReports({ weekly: true, monthly: true, recipient: null });
      for (const call of model.updateOne.mock.calls) expect(call[1].$set.reports.recipient).toBeNull();
    });

    it.each([
      ['weekly is not a boolean', { weekly: 'yes', monthly: true, recipient: null }],
      ['monthly is missing', { weekly: true, recipient: null }],
      ['recipient is not text', { weekly: true, monthly: true, recipient: 42 }],
      ['recipient is not an address', { weekly: true, monthly: true, recipient: 'not-an-email' }],
      ['recipient is too long', { weekly: true, monthly: true, recipient: `${'a'.repeat(250)}@example.com` }],
    ])('refuses when %s, writing nothing', async (_label, body) => {
      await expect(service.saveReports(body as any)).rejects.toThrow(BadRequestException);
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('saveAccounts', () => {
    it('replaces the accounts section in one upsert, trimming each entry', async () => {
      await service.saveAccounts({ cash: [' 1111 ', '2222'], senders: [' SOME NAME '] });
      expect(model.updateOne).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { accounts: { cash: ['1111', '2222'], senders: ['SOME NAME'] } } },
        { upsert: true },
      );
    });

    it.each([
      ['cash is not a list', { cash: '1111', senders: [] }],
      ['an entry is not text', { cash: [1111], senders: [] }],
      ['a cash account has 3 digits', { cash: ['123'], senders: [] }],
      ['a cash account has letters', { cash: ['abcd'], senders: [] }],
      ['a cash account has 5 digits', { cash: ['12345'], senders: [] }],
      ['a sender identifier is under 3 characters', { cash: [], senders: ['ab'] }],
      ['a sender identifier is over 40 characters', { cash: [], senders: ['x'.repeat(41)] }],
      ['a cash account is listed twice', { cash: ['1111', '1111'], senders: [] }],
      ['a sender identifier is listed twice in another case', { cash: [], senders: ['Some Name', 'some name'] }],
      ['a list has over 20 entries', { cash: Array.from({ length: 21 }, (_, i) => String(1000 + i)), senders: [] }],
    ])('refuses when %s, writing nothing', async (_label, body) => {
      await expect(service.saveAccounts(body as any)).rejects.toThrow(BadRequestException);
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- settings.service 2>&1 | tail -8
```
Expected: FAIL. The module `./settings.service` isn't found.

- [ ] **Step 3: Implement**

`api/src/settings/settings.service.ts`:
```ts
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
```

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **50 suites / 527 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/settings/settings.service.ts api/src/settings/settings.service.spec.ts
git commit -F- <<'EOF'
feat(api): settings resolve from what's saved, else the server's config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `/settings` routes and the module

**Files:**
- Create: `api/src/settings/settings.controller.ts`, `api/src/settings/settings.module.ts`
- Modify: `api/src/app.module.ts`
- Test: `api/src/transactions/transactions.controller.spec.ts` (the guard table)

- [ ] **Step 1: Write the failing test**

In `transactions.controller.spec.ts`, add `import { SettingsController } from '../settings/settings.controller';`, and the row `['SettingsController', SettingsController],` to the `describe.each` table.

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- transactions.controller 2>&1 | tail -6
```
Expected: FAIL. The module `../settings/settings.controller` isn't found.

- [ ] **Step 3: Implement**

`api/src/settings/settings.controller.ts`:
```ts
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AccountsInput, ReportsInput, SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  view() {
    return this.settings.view();
  }

  @Put('reports')
  saveReports(@Body() body: ReportsInput) {
    return this.settings.saveReports(body ?? {});
  }

  @Put('accounts')
  saveAccounts(@Body() body: AccountsInput) {
    return this.settings.saveAccounts(body ?? {});
  }
}
```
`api/src/settings/settings.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Settings, SettingsSchema } from '../shared/schemas/settings.schema';
import { ReportSend, ReportSendSchema } from '../shared/schemas/report-send.schema';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Settings.name, schema: SettingsSchema },
      { name: ReportSend.name, schema: ReportSendSchema },
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```
`api/src/app.module.ts`: add `import { SettingsModule } from './settings/settings.module';` and `SettingsModule,` at the end of `imports`.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **50 suites / 528 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/settings/settings.controller.ts api/src/settings/settings.module.ts api/src/app.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): GET /settings and PUT /settings/reports, /settings/accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `IngestionStatusService`

**Files:**
- Create: `api/src/ingestion/ingestion-status.service.ts`
- Test: `api/src/ingestion/ingestion-status.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`api/src/ingestion/ingestion-status.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger, NotFoundException } from '@nestjs/common';
import { IngestionStatusService } from './ingestion-status.service';
import { IngestionStatus } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail } from '../shared/schemas/unreadable-mail.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = {
    sort: jest.fn(() => q),
    limit: jest.fn(() => q),
    select: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return q;
}

const AT = new Date('2026-09-25T02:40:00Z');
const MAIL_ID = '64b0000000000000000000c1';

describe('IngestionStatusService', () => {
  let service: IngestionStatusService;
  let statusModel: { updateOne: jest.Mock; findOne: jest.Mock };
  let unreadableModel: { updateOne: jest.Mock; deleteOne: jest.Mock; find: jest.Mock; findOneAndUpdate: jest.Mock };
  let txModel: { find: jest.Mock };
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    delete process.env.INGEST_START_AT;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    statusModel = { updateOne: jest.fn().mockResolvedValue({}), findOne: jest.fn(() => query(null)) };
    unreadableModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      find: jest.fn(() => query([])),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: MAIL_ID }),
    };
    txModel = { find: jest.fn(() => query([])) };
    const mod = await Test.createTestingModule({
      providers: [
        IngestionStatusService,
        { provide: getModelToken(IngestionStatus.name), useValue: statusModel },
        { provide: getModelToken(UnreadableMail.name), useValue: unreadableModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
      ],
    }).compile();
    service = mod.get(IngestionStatusService);
  });

  afterEach(() => errorSpy.mockRestore());

  it("records a finished run's counts and clears the last error", async () => {
    await service.recordRun({ created: 1, skipped: 2, failed: 0 }, AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      { $set: { lastRunAt: AT, created: 1, skipped: 2, failed: 0, lastError: null } },
      { upsert: true },
    );
  });

  it('records a failed run with its message, cut to 500 characters', async () => {
    await service.recordFailure(new Error('x'.repeat(600)), AT);
    expect(statusModel.updateOne).toHaveBeenCalledWith(
      { userId: 1 },
      { $set: { lastError: 'x'.repeat(500), lastErrorAt: AT } },
      { upsert: true },
    );
  });

  it('never throws from a write: it logs instead', async () => {
    statusModel.updateOne.mockRejectedValue(new Error('db down'));
    unreadableModel.updateOne.mockRejectedValue(new Error('db down'));
    unreadableModel.deleteOne.mockRejectedValue(new Error('db down'));
    await expect(service.recordRun({ created: 0, skipped: 0, failed: 0 })).resolves.toBeUndefined();
    await expect(service.recordFailure(new Error('x'))).resolves.toBeUndefined();
    await expect(service.recordUnreadable({ messageId: 'm1', sender: 's', subject: 'x', receivedAt: AT })).resolves.toBeUndefined();
    await expect(service.clearUnreadable('m1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(4);
  });

  it('upserts an unreadable mail, counting each attempt', async () => {
    const receivedAt = new Date('2026-09-25T01:53:30Z');
    await service.recordUnreadable({ messageId: 'm1', sender: 'alerts@bank.example', subject: 'Alert', receivedAt }, AT);
    expect(unreadableModel.updateOne).toHaveBeenCalledWith(
      { userId: 1, messageId: 'm1' },
      {
        $set: { sender: 'alerts@bank.example', subject: 'Alert', receivedAt, lastSeenAt: AT },
        $setOnInsert: { firstSeenAt: AT, dismissed: false },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );
  });

  it('removes a mail from the list once it books', async () => {
    await service.clearUnreadable('m1');
    expect(unreadableModel.deleteOne).toHaveBeenCalledWith({ userId: 1, messageId: 'm1' });
  });

  describe('dismissedAmong', () => {
    it('returns the dismissed ones among the given message ids', async () => {
      const rows = query([{ messageId: 'm2' }]);
      unreadableModel.find.mockReturnValue(rows);
      expect(await service.dismissedAmong(['m1', 'm2'])).toEqual(new Set(['m2']));
      expect(unreadableModel.find).toHaveBeenCalledWith({ userId: 1, messageId: { $in: ['m1', 'm2'] }, dismissed: true });
      expect(rows.select).toHaveBeenCalledWith('messageId');
    });

    it('asks nothing for no ids', async () => {
      expect(await service.dismissedAmong([])).toEqual(new Set());
      expect(unreadableModel.find).not.toHaveBeenCalled();
    });

    it('treats a read failure as none dismissed, so the mails are simply retried', async () => {
      unreadableModel.find.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('db down')) }) });
      expect(await service.dismissedAmong(['m1'])).toEqual(new Set());
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('marks the mail dismissed', async () => {
      await service.dismiss(MAIL_ID);
      expect(unreadableModel.findOneAndUpdate).toHaveBeenCalledWith({ _id: MAIL_ID, userId: 1 }, { $set: { dismissed: true } });
    });

    it('is a 404 for a missing mail or a malformed id', async () => {
      unreadableModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(service.dismiss(MAIL_ID)).rejects.toThrow(NotFoundException);
      await expect(service.dismiss('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('view', () => {
    it('shows the last run, the last error, the unreadable mails and what mail booked lately', async () => {
      process.env.INGEST_START_AT = '2026-09-24T14:58:59Z';
      statusModel.findOne.mockReturnValue(
        query({ lastRunAt: AT, created: 1, skipped: 2, failed: 1, lastError: 'login refused', lastErrorAt: AT }),
      );
      const unreadable = query([
        { _id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT, dismissed: false },
      ]);
      unreadableModel.find.mockReturnValue(unreadable);
      const recent = query([{ _id: 't1', transactionName: 'store', amount: -120.5, category: 'food', timestamp: AT }]);
      txModel.find.mockReturnValue(recent);

      expect(await service.view(true)).toEqual({
        startAt: '2026-09-24T14:58:59Z',
        running: true,
        lastRun: { at: AT, created: 1, skipped: 2, failed: 1 },
        lastError: { at: AT, message: 'login refused' },
        unreadable: [{ id: MAIL_ID, sender: 's@bank.example', subject: 'Alert', receivedAt: AT, attempts: 3, lastSeenAt: AT }],
        recent: [{ id: 't1', name: 'store', amount: 120.5, isExpense: true, category: 'food', timestamp: AT }],
      });
      expect(unreadableModel.find).toHaveBeenCalledWith({ userId: 1, dismissed: false });
      expect(unreadable.sort).toHaveBeenCalledWith({ lastSeenAt: -1 });
      expect(unreadable.limit).toHaveBeenCalledWith(50);
      expect(txModel.find).toHaveBeenCalledWith({ userId: 1, source: 'email', deletedAt: null });
      expect(recent.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(recent.limit).toHaveBeenCalledWith(10);
    });

    it('shows nothing yet before the first run', async () => {
      const v = await service.view(false);
      expect(v).toEqual({ startAt: null, running: false, lastRun: null, lastError: null, unreadable: [], recent: [] });
    });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ingestion-status 2>&1 | tail -8
```
Expected: FAIL. The module `./ingestion-status.service` isn't found.

- [ ] **Step 3: Implement**

`api/src/ingestion/ingestion-status.service.ts`:
```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IngestionStatus } from '../shared/schemas/ingestion-status.schema';
import { UnreadableMail } from '../shared/schemas/unreadable-mail.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED } from '../shared/schemas/transfer-kind';

export interface RunCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface IngestionStatusView {
  startAt: string | null;
  running: boolean;
  lastRun: ({ at: Date } & RunCounts) | null;
  lastError: { at: Date; message: string } | null;
  unreadable: { id: string; sender: string; subject: string; receivedAt: Date; attempts: number; lastSeenAt: Date }[];
  recent: { id: string; name: string; amount: number; isExpense: boolean; category: string; timestamp: Date }[];
}

/**
 * The records behind the Settings page's "Bank mail" section: how the last run
 * went, and the mails no parser could read. Every write here is best effort: a
 * failure is logged and never fails an ingestion run.
 */
@Injectable()
export class IngestionStatusService {
  private readonly logger = new Logger(IngestionStatusService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(IngestionStatus.name) private readonly statusModel: Model<IngestionStatus>,
    @InjectModel(UnreadableMail.name) private readonly unreadableModel: Model<UnreadableMail>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
  ) {}

  async recordRun(counts: RunCounts, at = new Date()): Promise<void> {
    await this.quietly('record the run', () =>
      this.statusModel.updateOne(
        { userId: this.userId },
        { $set: { lastRunAt: at, created: counts.created, skipped: counts.skipped, failed: counts.failed, lastError: null } },
        { upsert: true },
      ),
    );
  }

  async recordFailure(err: unknown, at = new Date()): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await this.quietly('record the failed run', () =>
      this.statusModel.updateOne({ userId: this.userId }, { $set: { lastError: message, lastErrorAt: at } }, { upsert: true }),
    );
  }

  async recordUnreadable(
    mail: { messageId: string; sender: string; subject: string; receivedAt: Date },
    at = new Date(),
  ): Promise<void> {
    await this.quietly(`record unreadable mail ${mail.messageId}`, () =>
      this.unreadableModel.updateOne(
        { userId: this.userId, messageId: mail.messageId },
        {
          $set: { sender: mail.sender, subject: mail.subject, receivedAt: mail.receivedAt, lastSeenAt: at },
          $setOnInsert: { firstSeenAt: at, dismissed: false },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      ),
    );
  }

  async clearUnreadable(messageId: string): Promise<void> {
    await this.quietly(`clear unreadable mail ${messageId}`, () =>
      this.unreadableModel.deleteOne({ userId: this.userId, messageId }),
    );
  }

  /** The dismissed ones among these message ids. On a read failure, none: those mails are then simply retried. */
  async dismissedAmong(messageIds: string[]): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    try {
      const rows = await this.unreadableModel
        .find({ userId: this.userId, messageId: { $in: messageIds }, dismissed: true })
        .select('messageId')
        .lean();
      return new Set(rows.map((r) => r.messageId));
    } catch (err) {
      this.logger.error('Could not read dismissed mails; retrying them this run', err instanceof Error ? err.stack : String(err));
      return new Set();
    }
  }

  async dismiss(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such mail');
    const row = await this.unreadableModel.findOneAndUpdate({ _id: id, userId: this.userId }, { $set: { dismissed: true } });
    if (!row) throw new NotFoundException('No such mail');
  }

  async view(running: boolean): Promise<IngestionStatusView> {
    const [status, unreadable, recent] = await Promise.all([
      this.statusModel.findOne({ userId: this.userId }).lean(),
      this.unreadableModel.find({ userId: this.userId, dismissed: false }).sort({ lastSeenAt: -1 }).limit(50).lean(),
      this.txModel
        .find({ userId: this.userId, source: 'email', ...NOT_DELETED })
        .sort({ timestamp: -1 })
        .limit(10)
        .select('transactionName amount category timestamp')
        .lean(),
    ]);
    return {
      startAt: process.env.INGEST_START_AT?.trim() || null,
      running,
      lastRun: status?.lastRunAt
        ? { at: status.lastRunAt, created: status.created ?? 0, skipped: status.skipped ?? 0, failed: status.failed ?? 0 }
        : null,
      lastError: status?.lastError && status.lastErrorAt ? { at: status.lastErrorAt, message: status.lastError } : null,
      unreadable: unreadable.map((u) => ({
        id: String(u._id),
        sender: u.sender,
        subject: u.subject,
        receivedAt: u.receivedAt,
        attempts: u.attempts,
        lastSeenAt: u.lastSeenAt,
      })),
      recent: recent.map((t) => ({
        id: String(t._id),
        name: t.transactionName,
        amount: Math.abs(t.amount),
        isExpense: t.amount < 0,
        category: t.category,
        timestamp: t.timestamp,
      })),
    };
  }

  private async quietly(what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      this.logger.error(`Could not ${what}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
```

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **51 suites / 540 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/ingestion/ingestion-status.service.ts api/src/ingestion/ingestion-status.service.spec.ts
git commit -F- <<'EOF'
feat(api): record ingestion runs and the mails it couldn't read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The ingester uses Settings and records what happened

**Files:**
- Modify: `api/src/ingestion/ingestion.service.ts` (constructor, `poll`, `run`)
- Modify: `api/src/ingestion/ingestion.module.ts`
- Test: `api/src/ingestion/ingestion.service.spec.ts`

- [ ] **Step 1: Rewire the tests first**

In `ingestion.service.spec.ts`:
- Add the imports:
```ts
import { SettingsService } from '../settings/settings.service';
import { IngestionStatusService } from './ingestion-status.service';
```
- Next to the other `let`s:
```ts
  let settings: { accounts: jest.Mock };
  let status: {
    dismissedAmong: jest.Mock; recordUnreadable: jest.Mock; clearUnreadable: jest.Mock; recordRun: jest.Mock; recordFailure: jest.Mock;
  };
```
- In `beforeEach`, before `Test.createTestingModule`:
```ts
    settings = { accounts: jest.fn().mockResolvedValue({ cash: [], senders: [] }) };
    status = {
      dismissedAmong: jest.fn().mockResolvedValue(new Set()),
      recordUnreadable: jest.fn().mockResolvedValue(undefined),
      clearUnreadable: jest.fn().mockResolvedValue(undefined),
      recordRun: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
```
  and add the providers `{ provide: SettingsService, useValue: settings },` and `{ provide: IngestionStatusService, useValue: status },`.
- Replace the test `'trims OWN_ACCOUNT_IDENTIFIERS entries and drops empties, same as OWN_CASH_ACCOUNTS'` (and the comment above it) with:
```ts
  // The account lists come from Settings (saved on the web, else the server's
  // config); SettingsService owns the parsing, covered in its own spec.
  it('hands the parsers the account lists from SettingsService', async () => {
    settings.accounts.mockResolvedValue({ cash: ['1111'], senders: ['2222', 'SOME NAME'] });
    mail.fetchSince.mockResolvedValue([makeMail()]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    const callArgs = parserParseMock.mock.calls[0][0];
    expect(callArgs.ownCashAccounts).toEqual(['1111']);
    expect(callArgs.ownIdentifiers).toEqual(['2222', 'SOME NAME']);
  });
```
- Add after that test:
```ts
  it('skips a mail the user dismissed, before any parsing', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    status.dismissedAmong.mockResolvedValue(new Set(['m1']));

    const result = await service.run();

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(status.dismissedAmong).toHaveBeenCalledWith(['m1']);
    expect(parserParseMock).not.toHaveBeenCalled();
  });

  it('records a mail no parser could read, so the Settings page can show it', async () => {
    const m = makeMail({ messageId: 'm1' });
    mail.fetchSince.mockResolvedValue([m]);
    parserParseMock.mockReturnValue(null);

    await service.run();

    expect(status.recordUnreadable).toHaveBeenCalledWith(m);
  });

  it('records a mail whose parser threw as unreadable too', async () => {
    const m = makeMail({ messageId: 'm1' });
    mail.fetchSince.mockResolvedValue([m]);
    parserParseMock.mockImplementation(() => {
      throw new Error('parser exploded');
    });

    await service.run();

    expect(status.recordUnreadable).toHaveBeenCalledWith(m);
  });

  it('takes a mail off the unreadable list once it books', async () => {
    mail.fetchSince.mockResolvedValue([makeMail({ messageId: 'm1' })]);
    parserParseMock.mockReturnValue(makeParsed());

    await service.run();

    expect(status.clearUnreadable).toHaveBeenCalledWith('m1');
  });

  describe('runGuarded', () => {
    it("returns and records the run's counts", async () => {
      mail.fetchSince.mockResolvedValue([]);
      await expect(service.runGuarded()).resolves.toEqual({ created: 0, skipped: 0, failed: 0 });
      expect(status.recordRun).toHaveBeenCalledWith({ created: 0, skipped: 0, failed: 0 });
    });

    it('records and rethrows a run that failed as a whole; the cron entry point still never throws', async () => {
      const err = new Error('Cannot open mailbox "Banks"');
      mail.fetchSince.mockRejectedValue(err);
      await expect(service.runGuarded()).rejects.toThrow('Cannot open mailbox');
      expect(status.recordFailure).toHaveBeenCalledWith(err);
      await expect(service.poll()).resolves.toBeUndefined();
    });

    it('returns null while a run is in flight, and says it is running', async () => {
      let release!: () => void;
      mail.fetchSince.mockReturnValue(new Promise<FetchedMail[]>((resolve) => { release = () => resolve([]); }));
      const first = service.runGuarded();
      expect(service.isRunning).toBe(true);
      await expect(service.runGuarded()).resolves.toBeNull();
      release();
      await first;
      expect(service.isRunning).toBe(false);
    });
  });
```
  (`FetchedMail` is already imported by the spec for the existing in-flight test; if not, import it from `./mail.client`.)

Run them and see them fail:
```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- ingestion.service 2>&1 | grep -E "✕|Tests:"
```
Expected: the new tests fail, because `runGuarded`, `isRunning` and the status calls don't exist and the accounts still come from `process.env`.

- [ ] **Step 2: Implement**

In `ingestion.service.ts`:
- Add the imports:
```ts
import { SettingsService } from '../settings/settings.service';
import { IngestionStatusService, RunCounts } from './ingestion-status.service';
```
- Add two constructor parameters at the end: `private readonly settings: SettingsService,` and `private readonly status: IngestionStatusService,`.
- Replace the `poll()` method (keep the `@Cron(…)` decorator line and the comment above it) with:
```ts
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
```
- In `run()`:
  - Directly after `const known = await this.alreadyIngested(...)`, add:
```ts
    // Mails the user marked "Not a transaction" on the Settings page.
    const dismissed = await this.status.dismissedAmong(mails.map((m) => m.messageId));
```
  - Replace the two lines that read `OWN_ACCOUNT_IDENTIFIERS` / `OWN_CASH_ACCOUNTS` from `process.env` with:
```ts
    // Saved on the Settings page, else the server's config (see SettingsService).
    const { cash: ownCashAccounts, senders: ownIdentifiers } = await this.settings.accounts();
```
  - Change `if (known.has(mail.messageId)) { skipped++; continue; }` to `if (known.has(mail.messageId) || dismissed.has(mail.messageId)) { skipped++; continue; }`.
  - In the `if (!parsed) {` block, directly after the `this.logger.warn(...)` line, add `await this.status.recordUnreadable(mail);`.
  - Directly after `const result = await this.persist(parsed, mail.messageId, ctx);`, add:
```ts
      if (result === 'created' || result === 'duplicate') await this.status.clearUnreadable(mail.messageId);
```

In `ingestion.module.ts`:
- add `IngestionStatus` / `IngestionStatusSchema` and `UnreadableMail` / `UnreadableMailSchema` (imports from `../shared/schemas/…`) to `forFeature`;
- add `SettingsModule` (from `../settings/settings.module`) to `imports`;
- add `IngestionStatusService` to `providers`.

- [ ] **Step 3: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git grep -n "OWN_CASH_ACCOUNTS\|OWN_ACCOUNT_IDENTIFIERS" -- api/src
```
Expected:
- **51 suites / 547 tests**, all passing; the build is clean.
- The grep shows only `settings.service.ts` and its spec. Nothing else reads those variables now.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts api/src/ingestion/ingestion.module.ts
git commit -F- <<'EOF'
feat(api): the ingester reads accounts from Settings and records each run

Dismissed mails are skipped before parsing; an unreadable mail is kept
on record until it books; every run's counts, or its failure, are
recorded for the Settings page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `/ingestion` routes

**Files:**
- Create: `api/src/ingestion/ingestion.controller.ts`, `api/src/ingestion/ingestion.controller.spec.ts`
- Modify: `api/src/ingestion/ingestion.module.ts` (`controllers`)
- Test: `api/src/transactions/transactions.controller.spec.ts` (the guard table)

- [ ] **Step 1: Write the failing tests**

In `transactions.controller.spec.ts`, add `import { IngestionController } from '../ingestion/ingestion.controller';` and the row `['IngestionController', IngestionController],`.

`api/src/ingestion/ingestion.controller.spec.ts`:
```ts
import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { BadGatewayException, ConflictException } from '@nestjs/common';

// IngestionService carries a @Cron; @nestjs/schedule is ESM-only under this Jest setup.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { IngestionController } from './ingestion.controller';

describe('IngestionController', () => {
  const make = (ingestion: any, status: any) => new IngestionController(ingestion, status);

  it('shows the status, saying whether a run is in flight', async () => {
    const status = { view: jest.fn().mockResolvedValue({ running: true }) };
    await expect(make({ isRunning: true }, status).status()).resolves.toEqual({ running: true });
    expect(status.view).toHaveBeenCalledWith(true);
  });

  it("runs a check now and answers with its counts", async () => {
    const ingestion = { runGuarded: jest.fn().mockResolvedValue({ created: 1, skipped: 2, failed: 0 }) };
    await expect(make(ingestion, {}).run()).resolves.toEqual({ created: 1, skipped: 2, failed: 0 });
  });

  it('answers 409 while a run is in flight', async () => {
    await expect(make({ runGuarded: jest.fn().mockResolvedValue(null) }, {}).run()).rejects.toThrow(ConflictException);
  });

  it('answers 502 with the reason when the check fails', async () => {
    const ingestion = { runGuarded: jest.fn().mockRejectedValue(new Error('Invalid credentials')) };
    await expect(make(ingestion, {}).run()).rejects.toThrow(new BadGatewayException('The check failed: Invalid credentials'));
  });

  it('dismisses an unreadable mail', async () => {
    const status = { dismiss: jest.fn().mockResolvedValue(undefined) };
    await make({}, status).dismiss('m1');
    expect(status.dismiss).toHaveBeenCalledWith('m1');
  });

  it('answers 200 for a run and 204 for a dismiss', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, IngestionController.prototype.run)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, IngestionController.prototype.dismiss)).toBe(204);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- controller 2>&1 | tail -6
```
Expected: FAIL. `./ingestion.controller` isn't found.

- [ ] **Step 3: Implement**

`api/src/ingestion/ingestion.controller.ts`:
```ts
import { BadGatewayException, ConflictException, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { IngestionService } from './ingestion.service';
import { IngestionStatusService, RunCounts } from './ingestion-status.service';

@Controller('ingestion')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly statusService: IngestionStatusService,
  ) {}

  @Get('status')
  status() {
    return this.statusService.view(this.ingestion.isRunning);
  }

  /** Checks mail now: the same run the cron does, never overlapping it. */
  @Post('run')
  @HttpCode(200)
  async run(): Promise<RunCounts> {
    let counts: RunCounts | null;
    try {
      counts = await this.ingestion.runGuarded();
    } catch (err) {
      throw new BadGatewayException(`The check failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
    if (!counts) throw new ConflictException('A check is already running');
    return counts;
  }

  @Post('unreadable/:id/dismiss')
  @HttpCode(204)
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.statusService.dismiss(id);
  }
}
```
`ingestion.module.ts`: add `import { IngestionController } from './ingestion.controller';` and `controllers: [IngestionController],`.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **52 suites / 554 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/ingestion/ingestion.controller.ts api/src/ingestion/ingestion.controller.spec.ts api/src/ingestion/ingestion.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): GET /ingestion/status, POST /ingestion/run, dismiss an unreadable mail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Reports honour the switches and the recipient

**Files:**
- Modify: `api/src/reports/mailer.service.ts`, `report-scheduler.service.ts`, `reports.controller.ts`, `reports.module.ts`
- Test: `api/src/reports/mailer.service.spec.ts`, `report-scheduler.service.spec.ts`, `reports.controller.spec.ts`

- [ ] **Step 1: Rewire the tests first**

**`mailer.service.spec.ts`:** replace the two tests `'sends through Gmail SMTP to GMAIL_USER by default'` and `'sends to REPORT_TO when it is set'` with one test. Keep whatever setup the first one used to capture `sendMail` and its other expectations, such as the `from` and the transport options:
```ts
  it('sends through Gmail SMTP to the recipient it is given', async () => {
    // …the existing setup of the first replaced test…
    await service.send({ subject: 's', html: '<p>h</p>', text: 't' }, 'other@example.com');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'other@example.com' }));
  });
```
Update every other `service.send(email)` call in that spec to pass a recipient: `service.send(email, 'me@example.com')`.

**`report-scheduler.service.spec.ts`:**
- Add `import { SettingsService } from '../settings/settings.service';`, `let settings: { reports: jest.Mock };`, and in `beforeEach`:
  - `settings = { reports: jest.fn().mockResolvedValue({ weekly: true, monthly: true, recipient: 'me@example.com' }) };`
  - the provider `{ provide: SettingsService, useValue: settings },`.
- In `'claims a due digest, sends it once and records it'`, change the send expectation to:
```ts
    expect(mailer.send).toHaveBeenCalledWith({ subject: 'weekly', html: '<p>w</p>', text: 'w' }, 'me@example.com');
```
  Update any other `mailer.send` argument expectation in the file the same way.
- Add:
```ts
  it('records a report turned off in Settings as skipped, and sends nothing', async () => {
    settings.reports.mockResolvedValue({ weekly: false, monthly: true, recipient: 'me@example.com' });
    await service.run(NOW);
    expect(sendModel.create).toHaveBeenCalledWith({ ...key, status: 'skipped', at: NOW });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Not sending weekly report 2026-W39: turned off in Settings');
  });
```

**`reports.controller.spec.ts`:** the controller gains a third constructor argument.
- Add `const settings = { reports: jest.fn().mockResolvedValue({ weekly: true, monthly: true, recipient: 'me@example.com' }) };`, fresh in each test or reset in a `beforeEach`.
- Pass it as the third argument of every `new ReportsController(…)`.
- In `'emails the latest weekly digest now, marked [Test]'`, change the send expectation to:
```ts
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/^\[Test\] Weekly digest · /) }),
      'me@example.com',
    );
```
- Add:
```ts
  it('answers 503 and sends nothing when there is no recipient', async () => {
    const mailer = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn() };
    const noRecipient = { reports: jest.fn().mockResolvedValue({ weekly: true, monthly: true, recipient: null }) };
    const controller = new ReportsController({ weekly: jest.fn() } as any, mailer as any, noRecipient as any);
    await expect(controller.sendTest()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mailer.send).not.toHaveBeenCalled();
  });
```
- If the `'is wired…'` test asserts `ReportsModule`'s imports exactly, add `SettingsModule` to its expectation.

Run and see the failures:
```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- reports mailer 2>&1 | grep -E "✕|Tests:"
```

- [ ] **Step 2: Implement**

**`mailer.service.ts`:**
- `send(email: OutgoingEmail, to: string): Promise<void>`, with `to,` in `sendMail` in place of `to: process.env.REPORT_TO || user,`.
- Update the class docblock's recipient sentence to: "The recipient is resolved by the caller from Settings (saved on the web, else `REPORT_TO`, else `GMAIL_USER`)."

**`report-scheduler.service.ts`:**
- Import `SettingsService` from `'../settings/settings.service'`, and add the constructor parameter `private readonly settings: SettingsService,` last.
- In `run(now)`, inside the outer `try`, before the `for` loop, add `const prefs = await this.settings.reports();` and pass it to `handle`: `outcome = await this.handle(period, now, prefs);`.
- Change `handle`'s signature to `private async handle(period: ReportPeriod, now: Date, prefs: { weekly: boolean; monthly: boolean; recipient: string | null }): Promise<Outcome | 'not-configured' | 'idle'>`.
- In `handle`, directly after the `if (existing) { … }` block, add:
```ts
    if (!prefs[period.kind]) {
      // Turned off in Settings: recorded like an expired report, so turning it
      // back on later never sends an old one.
      try {
        await this.sendModel.create({ ...key, status: 'skipped', at: now });
      } catch (err: any) {
        if (err?.code === 11000) return 'idle';
        throw err;
      }
      this.logger.log(`Not sending ${period.kind} report ${period.key}: turned off in Settings`);
      return 'skipped';
    }
```
- Change `if (!this.mailer.isConfigured()) {` to `if (!this.mailer.isConfigured() || !prefs.recipient) {`.
- Pass the recipient through both calls to `send`: `this.send(period, now, prefs.recipient)`. Include the stale takeover path's call, which receives `prefs` from `handle`.
- Change `send` to `private async send(period: ReportPeriod, now: Date, recipient: string | null): Promise<Outcome>`, and its mail call to `await this.mailer.send(email, recipient as string);`.
- The takeover path can reach `send` with no recipient if Gmail was configured when the claim was made. The `send` failure path already releases the claim and retries, and `mailer.send` throws without credentials. That's acceptable; no extra branch is needed.

**`reports.controller.ts`:**
- Add the constructor parameter `private readonly settings: SettingsService,` last.
- In `sendTest()`:
```ts
    const { recipient } = await this.settings.reports();
    if (!this.mailer.isConfigured() || !recipient) {
      throw new ServiceUnavailableException('Email is not configured on the server');
    }
```
  and `await this.mailer.send(email, recipient);`.

**`reports.module.ts`:** add `SettingsModule` (from `'../settings/settings.module'`) to `imports`.

- [ ] **Step 3: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git grep -n "REPORT_TO" -- api/src
```
Expected:
- **52 suites / 555 tests**, all passing; the build is clean.
- `REPORT_TO` appears only in `settings.service.ts`, its spec, and the mailer's docblock.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/reports/mailer.service.ts api/src/reports/mailer.service.spec.ts api/src/reports/report-scheduler.service.ts api/src/reports/report-scheduler.service.spec.ts api/src/reports/reports.controller.ts api/src/reports/reports.controller.spec.ts api/src/reports/reports.module.ts
git commit -F- <<'EOF'
feat(api): reports follow Settings — each can be turned off, and go where you say

A report turned off is recorded as skipped when it falls due, so turning
it back on never sends an old one. Scheduled and test sends go to the
recipient resolved from Settings.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Web models and api calls

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`, `web/src/app/core/services/api.service.ts`

- [ ] **Step 1: Models**

Append to `api.models.ts`:
```ts
// ── Settings ────────────────────────────────────────────────────────────
export type SettingSource = 'saved' | 'config';

export interface SettingValue<T> {
  value: T;
  source: SettingSource;
}

export interface LastSent {
  period: string;
  at: string;
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

export interface ReportsSettingsInput {
  weekly: boolean;
  monthly: boolean;
  recipient: string | null;
}

export interface AccountsSettingsInput {
  cash: string[];
  senders: string[];
}

export interface RunCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface UnreadableMailItem {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  attempts: number;
  lastSeenAt: string;
}

export interface MailBookedItem {
  id: string;
  name: string;
  amount: number;
  isExpense: boolean;
  category: string;
  timestamp: string;
}

export interface IngestionStatusView {
  startAt: string | null;
  running: boolean;
  lastRun: (RunCounts & { at: string }) | null;
  lastError: { at: string; message: string } | null;
  unreadable: UnreadableMailItem[];
  recent: MailBookedItem[];
}
```

- [ ] **Step 2: Calls**

In `api.service.ts`:
- Add `SettingsView`, `ReportsSettingsInput`, `AccountsSettingsInput`, `IngestionStatusView` and `RunCounts` to the `api.models` import.
- Add after `sendTestDigest()`:
```ts
  getSettings(): Observable<SettingsView> {
    return this.http.get<SettingsView>(`${this.base}/settings`);
  }

  saveReportSettings(body: ReportsSettingsInput): Observable<SettingsView> {
    return this.http.put<SettingsView>(`${this.base}/settings/reports`, body);
  }

  saveAccountSettings(body: AccountsSettingsInput): Observable<SettingsView> {
    return this.http.put<SettingsView>(`${this.base}/settings/accounts`, body);
  }

  getIngestionStatus(): Observable<IngestionStatusView> {
    return this.http.get<IngestionStatusView>(`${this.base}/ingestion/status`);
  }

  /** Checks bank mail now. 409 while a check is already running. */
  runIngestion(): Observable<RunCounts> {
    return this.http.post<RunCounts>(`${this.base}/ingestion/run`, {});
  }

  dismissUnreadable(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/ingestion/unreadable/${id}/dismiss`, {});
  }
```

- [ ] **Step 3: Build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: `web-done` alone.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/core/services/api.models.ts web/src/app/core/services/api.service.ts
git commit -F- <<'EOF'
feat(web): API calls for settings and mail ingestion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: The "Bank mail" section

**Files:**
- Create: `web/src/app/pages/settings/settings-section.scss`
- Create: `web/src/app/pages/settings/mail-section/mail-section.component.ts` and `.html`

- [ ] **Step 1: Shared section styles**

`web/src/app/pages/settings/settings-section.scss`, theme tokens only:
```scss
// Styles shared by the Settings page's three section components.
:host { display: block; }

.set-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
}

h2 { margin: 0; font-size: 1.1rem; color: var(--text); }

h3 {
  margin: var(--space-sm) 0 0;
  font-size: 0.95rem;
  color: var(--text);
  &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
}

.set-line { margin: 0; color: var(--text); }
.set-muted { margin: 0; font-size: 0.85rem; color: var(--text-muted); }
.set-source { font-size: 0.75rem; font-style: italic; color: var(--text-muted); }

.set-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }

.set-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

.set-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--border);
  &:last-child { border-bottom: none; }
}

.set-row-main { flex: 1 1 14rem; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.set-row-title { color: var(--text); overflow-wrap: anywhere; }

.set-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); color: var(--text); }

.set-amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  &.expense { color: var(--expense); }
  &.income { color: var(--income); }
}

.set-link { color: var(--accent); font-size: 0.875rem; }

.set-field { max-width: 24rem; }

.set-check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  color: var(--text);
  input { margin-top: 3px; }
}

.set-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2xs); }

.set-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--text);

  button {
    display: inline-flex;
    padding: 2px;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    &:hover { background: var(--color-surface-hover); color: var(--text); }
    &:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 1px; }
    mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
  }
}

.set-add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-xs);
  .fc-field { flex: 1 1 12rem; min-width: 0; max-width: 20rem; }
}

@media (max-width: 640px) {
  .set-add {
    flex-direction: column;
    align-items: stretch;
    .fc-field { flex: 0 0 auto; max-width: none; }
  }
}
```

- [ ] **Step 2: The component**

`mail-section.component.ts`:
```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { IngestionStatusView, RunCounts } from '../../../core/services/api.models';
import { CategoryService } from '../../../core/services/category.service';
import { TransactionEventsService } from '../../../core/services/transaction-events.service';

/** Settings › Bank mail: how ingestion is doing, a check on demand, and the mails it couldn't read. */
@Component({
  selector: 'app-mail-section',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink],
  templateUrl: './mail-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class MailSectionComponent implements OnInit, OnDestroy {
  status: IngestionStatusView | null = null;
  loading = true;
  loadError = '';
  checking = false;
  checkResult = '';
  checkError = '';
  /** The mail whose "Not a transaction" is waiting for a yes. */
  confirming: string | null = null;
  dismissing = false;
  dismissError = '';

  private gen = 0;
  private destroyed = false;
  private readonly subs = new Subscription();

  constructor(
    private readonly api: ApiService,
    private readonly catSvc: CategoryService,
    private readonly events: TransactionEventsService,
  ) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  catColor(category: string) {
    return this.catSvc.color(category);
  }

  checkNow() {
    if (this.checking || this.status?.running) return;
    this.checking = true;
    this.checkResult = '';
    this.checkError = '';
    this.subs.add(
      this.api.runIngestion().subscribe({
        next: (c: RunCounts) => {
          this.checking = false;
          this.checkResult = `Booked ${c.created}, skipped ${c.skipped}, couldn't read ${c.failed}.`;
          if (c.created > 0) this.events.notify(); // new transactions: every list reloads
          this.load(() => this.focus('check-mail'));
        },
        error: (e: HttpErrorResponse) => {
          this.checking = false;
          this.checkError = e.status === 409 ? 'A check is already running.' : this.message(e, "Couldn't check mail. Please try again.");
          this.load(() => this.focus('check-mail'));
        },
      }),
    );
  }

  askDismiss(id: string) {
    this.confirming = id;
    this.dismissError = '';
    this.focus(`dismiss-yes-${id}`);
  }

  cancelDismiss(id: string) {
    this.confirming = null;
    this.focus(`dismiss-${id}`);
  }

  confirmDismiss(id: string) {
    if (this.dismissing) return;
    const list = this.status?.unreadable ?? [];
    const next = list[list.findIndex((m) => m.id === id) + 1]?.id;
    this.dismissing = true;
    this.dismissError = '';
    this.subs.add(
      this.api.dismissUnreadable(id).subscribe({
        next: () => {
          this.dismissing = false;
          this.confirming = null;
          this.load(() => this.focus(...(next ? [`dismiss-${next}`] : []), 'unreadable-heading'));
        },
        error: (e: HttpErrorResponse) => {
          this.dismissing = false;
          this.dismissError = this.message(e, "Couldn't dismiss it. Please try again.");
          this.load();
        },
      }),
    );
  }

  /** Reads the status; a reply older than the newest request is dropped. */
  private load(then?: () => void) {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getIngestionStatus().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.status = s;
          this.loading = false;
          this.loadError = '';
          if (this.confirming && !s.unreadable.some((m) => m.id === this.confirming)) this.confirming = null;
          then?.();
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.loadError = "Couldn't load the mail status.";
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]) {
    setTimeout(() => {
      if (this.destroyed) return;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          return;
        }
      }
    }, 0);
  }
}
```

`mail-section.component.html`:
```html
<section class="card set-section" aria-labelledby="mail-title">
  <h2 id="mail-title">Bank mail</h2>

  @if (loading) {
    <p class="set-muted">Loading…</p>
  } @else if (loadError) {
    <p class="fc-error" role="alert">{{ loadError }}</p>
  } @else if (status) {
    <p class="set-line">
      @if (status.lastRun; as run) {
        Last checked {{ run.at | date: 'MMM d, h:mm a' }} · booked {{ run.created }} · skipped {{ run.skipped }} · couldn't read {{ run.failed }}
      } @else {
        Not checked yet
      }
    </p>
    @if (status.lastError; as err) {
      <p class="fc-error" role="alert">The last check failed at {{ err.at | date: 'MMM d, h:mm a' }}: {{ err.message }}</p>
    }
    <p class="set-muted">
      @if (status.startAt) {
        Reading mail since {{ status.startAt | date: 'MMM d, y, h:mm a' }}
      } @else {
        Reading the last 24 hours of mail
      }
    </p>

    <div class="set-actions">
      <button id="check-mail" type="button" class="fc-btn fc-btn--primary" [disabled]="checking || status.running" (click)="checkNow()">
        {{ checking || status.running ? 'Checking…' : 'Check mail now' }}
      </button>
    </div>
    <p class="set-muted" aria-live="polite">{{ checkResult }}</p>
    @if (checkError) {
      <p class="fc-error" role="alert">{{ checkError }}</p>
    }

    <h3 id="unreadable-heading" tabindex="-1">Couldn't read</h3>
    @if (status.unreadable.length === 0) {
      <p class="set-muted">Every mail since {{ status.startAt ? (status.startAt | date: 'MMM d') : 'yesterday' }} was read.</p>
    } @else {
      <ul class="set-list">
        @for (m of status.unreadable; track m.id) {
          <li class="set-row">
            <div class="set-row-main">
              <span class="set-row-title">{{ m.subject || '(no subject)' }}</span>
              <span class="set-muted">
                {{ m.sender }} · arrived {{ m.receivedAt | date: 'MMM d, h:mm a' }} · tried {{ m.attempts }} {{ m.attempts === 1 ? 'time' : 'times' }}
              </span>
            </div>
            @if (confirming === m.id) {
              <div class="set-confirm">
                <span>Stop retrying this mail?</span>
                <button [id]="'dismiss-yes-' + m.id" type="button" class="fc-btn fc-btn--primary" [disabled]="dismissing" (click)="confirmDismiss(m.id)">
                  {{ dismissing ? 'Dismissing…' : 'Yes' }}
                </button>
                <button type="button" class="fc-btn fc-btn--ghost" [disabled]="dismissing" (click)="cancelDismiss(m.id)">Cancel</button>
              </div>
            } @else {
              <button [id]="'dismiss-' + m.id" type="button" class="fc-btn fc-btn--ghost" [disabled]="confirming !== null" (click)="askDismiss(m.id)">
                Not a transaction
              </button>
            }
          </li>
        }
      </ul>
      @if (dismissError) {
        <p class="fc-error" role="alert">{{ dismissError }}</p>
      }
    }

    <h3>Recently booked from mail</h3>
    @if (status.recent.length === 0) {
      <p class="set-muted">Nothing booked from mail yet.</p>
    } @else {
      <ul class="set-list">
        @for (t of status.recent; track t.id) {
          <li class="set-row">
            <div class="set-row-main">
              <span class="set-row-title">{{ t.name }}</span>
              <span class="set-muted">{{ t.timestamp | date: 'MMM d, h:mm a' }}</span>
            </div>
            <span class="cat-pill" [style.background]="catColor(t.category) + '22'" [style.color]="catColor(t.category)">
              <span class="dot" [style.background]="catColor(t.category)"></span>
              {{ t.category | titlecase }}
            </span>
            <span class="set-amount" [class.expense]="t.isExpense" [class.income]="!t.isExpense">
              {{ t.isExpense ? '−' : '+' }}{{ t.amount | currency: 'USD' : 'symbol' : '1.2-2' }}
            </span>
          </li>
        }
      </ul>
      <a routerLink="/transactions" class="set-link">See all transactions</a>
    }
  }
</section>
```

- [ ] **Step 3: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" web/src/app/pages/settings/settings-section.scss; echo literal-done
```
Expected: `web-done` alone and `literal-done` alone. The component isn't used by a route yet; Task 12 adds that. An unused standalone component still compiles.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/settings/settings-section.scss web/src/app/pages/settings/mail-section/mail-section.component.ts web/src/app/pages/settings/mail-section/mail-section.component.html
git commit -F- <<'EOF'
feat(web): Settings › Bank mail — status, check now, unreadable mails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: The "Email reports" section; the test digest leaves the Dashboard

**Files:**
- Create: `web/src/app/pages/settings/reports-section/reports-section.component.ts` and `.html`
- Modify: `web/src/app/pages/dashboard/dashboard.component.ts` and `.html` (and `.scss` if a rule becomes unused)

- [ ] **Step 1: The component**

`reports-section.component.ts`:
```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingsView } from '../../../core/services/api.models';

type ReportsView = SettingsView['reports'];

/** Settings › Email reports: which reports go out, to whom, and a test send. */
@Component({
  selector: 'app-reports-section',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  templateUrl: './reports-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class ReportsSectionComponent implements OnInit, OnDestroy {
  view: ReportsView | null = null;
  loading = true;
  loadError = '';
  weekly = true;
  monthly = true;
  recipient = '';
  saving = false;
  saveError = '';
  saved = '';
  testState: 'idle' | 'sending' | 'sent' | 'error' = 'idle';
  testError = '';

  private gen = 0;
  private destroyed = false;
  private testTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    if (this.testTimer) clearTimeout(this.testTimer);
  }

  /** Where reports go when the field is empty: the server's address, when the view knows it. */
  get fallback(): string {
    return this.view?.recipient.source === 'config' ? this.view.recipient.value ?? '' : '';
  }

  get dirty(): boolean {
    const v = this.view;
    if (!v) return false;
    return this.weekly !== v.weekly.value || this.monthly !== v.monthly.value || this.recipient.trim() !== this.savedRecipient;
  }

  get testLabel(): string {
    switch (this.testState) {
      case 'sending': return 'Sending…';
      case 'sent': return 'Sent — check your inbox';
      default: return 'Send a test digest';
    }
  }

  save() {
    if (!this.dirty || this.saving) return;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.saveReportSettings({ weekly: this.weekly, monthly: this.monthly, recipient: this.recipient.trim() || null }).subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.reports);
          this.saved = 'Saved.';
          this.focus('reports-weekly'); // Save is disabled again, so focus moves to the form
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't save. Please try again.");
          this.focus('reports-recipient');
        },
      }),
    );
  }

  sendTest() {
    if (this.testState === 'sending') return;
    if (this.testTimer) {
      clearTimeout(this.testTimer);
      this.testTimer = null;
    }
    this.testState = 'sending';
    this.testError = '';
    this.subs.add(
      this.api.sendTestDigest().subscribe({
        next: () => {
          this.testState = 'sent';
          this.testTimer = setTimeout(() => {
            this.testState = 'idle';
            this.testTimer = null;
          }, 5000);
        },
        error: (e: HttpErrorResponse) => {
          this.testState = 'error';
          this.testError = e.status === 503 ? "Email isn't configured on the server" : "Couldn't send the test email";
        },
      }),
    );
  }

  private get savedRecipient(): string {
    return this.view?.recipient.source === 'saved' ? this.view.recipient.value ?? '' : '';
  }

  private apply(v: ReportsView) {
    this.view = v;
    this.weekly = v.weekly.value;
    this.monthly = v.monthly.value;
    this.recipient = this.savedRecipient;
  }

  private load() {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getSettings().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.apply(s.reports);
          this.loading = false;
          this.loadError = '';
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.loadError = "Couldn't load the report settings.";
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  private focus(id: string) {
    setTimeout(() => {
      if (!this.destroyed) document.getElementById(id)?.focus();
    }, 0);
  }
}
```

`reports-section.component.html`:
```html
<section class="card set-section" aria-labelledby="reports-title">
  <h2 id="reports-title">Email reports</h2>

  @if (loading) {
    <p class="set-muted">Loading…</p>
  } @else if (loadError) {
    <p class="fc-error" role="alert">{{ loadError }}</p>
  } @else if (view) {
    <form class="set-section-form" (ngSubmit)="save()">
      <label class="set-check">
        <input id="reports-weekly" type="checkbox" [(ngModel)]="weekly" name="weekly" />
        <span>
          Weekly digest <span class="set-muted">(Mondays, 7:00 AM)</span><br />
          <span class="set-muted">{{ view.lastSent.weekly ? 'Last sent ' + (view.lastSent.weekly.at | date: 'MMM d, y') : 'Not sent yet' }}</span>
        </span>
      </label>
      <label class="set-check">
        <input type="checkbox" [(ngModel)]="monthly" name="monthly" />
        <span>
          Monthly summary <span class="set-muted">(the 1st, 7:00 AM)</span><br />
          <span class="set-muted">{{ view.lastSent.monthly ? 'Last sent ' + (view.lastSent.monthly.at | date: 'MMM d, y') : 'Not sent yet' }}</span>
        </span>
      </label>

      <label class="fc-field set-field">
        <span>Send to</span>
        <input
          id="reports-recipient"
          class="fc-input"
          type="email"
          autocomplete="email"
          maxlength="254"
          [(ngModel)]="recipient"
          name="recipient"
          [placeholder]="fallback || 'The server’s address'"
        />
      </label>
      @if (view.recipient.source === 'config') {
        <span class="set-source">From the server's config</span>
      }

      @if (saveError) {
        <p class="fc-error" role="alert">{{ saveError }}</p>
      }
      <p class="set-muted" aria-live="polite">{{ saved }}</p>

      <div class="set-actions">
        <button type="submit" class="fc-btn fc-btn--primary" [disabled]="!dirty || saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <button type="button" class="fc-btn fc-btn--ghost" [disabled]="testState === 'sending'" (click)="sendTest()">
          <mat-icon>{{ testState === 'sent' ? 'mark_email_read' : 'mail' }}</mat-icon>
          {{ testLabel }}
        </button>
      </div>
      @if (testState === 'error') {
        <p class="fc-error" role="alert">{{ testError }}</p>
      }
    </form>
  }
</section>
```
Append to `settings-section.scss`:
```scss
.set-section-form { display: flex; flex-direction: column; gap: var(--space-xs); }
```

- [ ] **Step 2: The Dashboard gives up the test digest**

In `dashboard.component.html`:
- remove the `<button … (click)="sendTestDigest()">…</button>` inside `.dash-actions`, leaving the Live Sync badge;
- remove the `@if (testDigest === 'error') { … }` block under the header.

In `dashboard.component.ts`, remove:
- `testDigest`, `testDigestError`, `testDigestTimer` and `testDigestSub`;
- their clean-up lines in `ngOnDestroy`;
- `sendTestDigest()` and `get testDigestLabel()`;
- any import only they used (`HttpErrorResponse`, if nothing else uses it).

If `.dash-actions` keeps `aria-live="polite"` only for the test button's label, remove that attribute. If a style in `dashboard.component.scss` now styles nothing, remove it.

- [ ] **Step 3: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git grep -n "testDigest\|sendTestDigest" -- web/src
```
Expected:
- `web-done` alone;
- the grep shows `sendTestDigest` only in `api.service.ts` and the reports section.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/settings/reports-section/reports-section.component.ts web/src/app/pages/settings/reports-section/reports-section.component.html web/src/app/pages/settings/settings-section.scss web/src/app/pages/dashboard/dashboard.component.ts web/src/app/pages/dashboard/dashboard.component.html
git status --short
git commit -F- <<'EOF'
feat(web): Settings › Email reports; the test digest moves here from the Dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
(Also add `dashboard.component.scss` if you changed it.)

---

### Task 11: The "Your accounts" section

**Files:**
- Create: `web/src/app/pages/settings/accounts-section/accounts-section.component.ts` and `.html`

- [ ] **Step 1: The component**

`accounts-section.component.ts`:
```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingsView } from '../../../core/services/api.models';

type AccountsView = SettingsView['accounts'];
type ListKey = 'cash' | 'senders';

const MAX_ENTRIES = 20;

/** Settings › Your accounts: the identifiers that tell your own transfers from real spending. */
@Component({
  selector: 'app-accounts-section',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './accounts-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class AccountsSectionComponent implements OnInit, OnDestroy {
  view: AccountsView | null = null;
  loading = true;
  loadError = '';
  cash: string[] = [];
  senders: string[] = [];
  draft: Record<ListKey, string> = { cash: '', senders: '' };
  draftError: Record<ListKey, string> = { cash: '', senders: '' };
  confirmEmpty = false;
  saving = false;
  saveError = '';
  saved = '';

  private gen = 0;
  private destroyed = false;
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  get dirty(): boolean {
    const v = this.view;
    if (!v) return false;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    return !same(this.cash, v.cash.value) || !same(this.senders, v.senders.value);
  }

  /** Why a value can't be added (the api's own rules), or '' when it can. */
  problem(list: ListKey, v: string): string {
    if (!v) return 'Type a value first.';
    if (list === 'cash' && !/^\d{4}$/.test(v)) return 'Use the last 4 digits, like 1234.';
    if (list === 'senders' && v.length < 3) return 'Use at least 3 characters.';
    if (list === 'senders' && v.length > 40) return 'Use at most 40 characters.';
    if (this[list].some((x) => x.toLowerCase() === v.toLowerCase())) return `${v} is already listed.`;
    if (this[list].length >= MAX_ENTRIES) return `At most ${MAX_ENTRIES} entries.`;
    return '';
  }

  add(list: ListKey) {
    const v = this.draft[list].trim();
    const problem = this.problem(list, v);
    this.draftError[list] = problem;
    if (problem) return;
    this[list] = [...this[list], v];
    this.draft[list] = '';
    this.saved = '';
    this.focus(`${list}-input`);
  }

  remove(list: ListKey, index: number) {
    this[list] = this[list].filter((_, i) => i !== index);
    this.saved = '';
    const left = this[list].length;
    this.focus(...(left ? [`${list}-remove-${Math.min(index, left - 1)}`] : []), `${list}-input`);
  }

  save() {
    if (!this.dirty || this.saving) return;
    if (this.cash.length === 0 && !this.confirmEmpty) {
      this.confirmEmpty = true;
      this.focus('accounts-confirm-yes');
      return;
    }
    this.confirmEmpty = false;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.saveAccountSettings({ cash: this.cash, senders: this.senders }).subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.accounts);
          this.saved = 'Saved. It applies to mail read from now on.';
          this.focus('cash-input'); // Save is disabled again, so focus moves to the form
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't save. Please try again.");
          this.focus('accounts-save');
        },
      }),
    );
  }

  cancelEmpty() {
    this.confirmEmpty = false;
    this.focus('accounts-save');
  }

  private apply(v: AccountsView) {
    this.view = v;
    this.cash = [...v.cash.value];
    this.senders = [...v.senders.value];
  }

  private load() {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getSettings().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.apply(s.accounts);
          this.loading = false;
          this.loadError = '';
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.loadError = "Couldn't load your accounts.";
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]) {
    setTimeout(() => {
      if (this.destroyed) return;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          return;
        }
      }
    }, 0);
  }
}
```

`accounts-section.component.html`:
```html
<section class="card set-section" aria-labelledby="accounts-title">
  <h2 id="accounts-title">Your accounts</h2>

  @if (loading) {
    <p class="set-muted">Loading…</p>
  } @else if (loadError) {
    <p class="fc-error" role="alert">{{ loadError }}</p>
  } @else if (view) {
    <h3 id="cash-title">Cash accounts (last 4 digits)</h3>
    <p class="set-muted">A transfer into one of these is money moving between your own accounts, not spending.</p>
    @if (view.cash.source === 'config') {
      <span class="set-source">From the server's config</span>
    }
    @if (cash.length) {
      <ul class="set-chips" aria-labelledby="cash-title">
        @for (v of cash; track v; let i = $index) {
          <li class="set-chip">
            {{ v }}
            <button [id]="'cash-remove-' + i" type="button" [attr.aria-label]="'Remove ' + v" (click)="remove('cash', i)">
              <mat-icon>close</mat-icon>
            </button>
          </li>
        }
      </ul>
    } @else {
      <p class="set-muted">None yet.</p>
    }
    <div class="set-add">
      <label class="fc-field">
        <span>Add a cash account</span>
        <input
          id="cash-input"
          class="fc-input"
          inputmode="numeric"
          maxlength="4"
          autocomplete="off"
          [(ngModel)]="draft.cash"
          (keydown.enter)="$event.preventDefault(); add('cash')"
        />
      </label>
      <button type="button" class="fc-btn fc-btn--ghost" (click)="add('cash')">Add</button>
    </div>
    @if (draftError.cash) {
      <p class="fc-error" role="alert">{{ draftError.cash }}</p>
    }

    <h3 id="senders-title">How you appear as a sender (last 4 digits or part of your name)</h3>
    <p class="set-muted">Used to recognise transfers you send.</p>
    @if (view.senders.source === 'config') {
      <span class="set-source">From the server's config</span>
    }
    @if (senders.length) {
      <ul class="set-chips" aria-labelledby="senders-title">
        @for (v of senders; track v; let i = $index) {
          <li class="set-chip">
            {{ v }}
            <button [id]="'senders-remove-' + i" type="button" [attr.aria-label]="'Remove ' + v" (click)="remove('senders', i)">
              <mat-icon>close</mat-icon>
            </button>
          </li>
        }
      </ul>
    } @else {
      <p class="set-muted">None yet.</p>
    }
    <div class="set-add">
      <label class="fc-field">
        <span>Add a sender identifier</span>
        <input
          id="senders-input"
          class="fc-input"
          maxlength="40"
          autocomplete="off"
          [(ngModel)]="draft.senders"
          (keydown.enter)="$event.preventDefault(); add('senders')"
        />
      </label>
      <button type="button" class="fc-btn fc-btn--ghost" (click)="add('senders')">Add</button>
    </div>
    @if (draftError.senders) {
      <p class="fc-error" role="alert">{{ draftError.senders }}</p>
    }

    <p class="set-muted">Applies to mail read from now on. Transactions already booked keep their classification.</p>
    @if (confirmEmpty) {
      <div class="set-confirm" role="alert">
        <span>With no cash accounts, every transfer is booked as spending. Save anyway?</span>
        <button id="accounts-confirm-yes" type="button" class="fc-btn fc-btn--primary" (click)="save()">Save anyway</button>
        <button type="button" class="fc-btn fc-btn--ghost" (click)="cancelEmpty()">Cancel</button>
      </div>
    }
    @if (saveError) {
      <p class="fc-error" role="alert">{{ saveError }}</p>
    }
    <p class="set-muted" aria-live="polite">{{ saved }}</p>
    <div class="set-actions">
      <button id="accounts-save" type="button" class="fc-btn fc-btn--primary" [disabled]="!dirty || saving || confirmEmpty" (click)="save()">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  }
</section>
```

- [ ] **Step 2: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: `web-done` alone.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/settings/accounts-section/accounts-section.component.ts web/src/app/pages/settings/accounts-section/accounts-section.component.html
git commit -F- <<'EOF'
feat(web): Settings › Your accounts — the lists that tell transfers from spending

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: The page, its route, the nav and the gear link

**Files:**
- Create: `web/src/app/pages/settings/settings.component.ts`, `.html` and `.scss`
- Modify: `web/src/app/app.routes.ts`, `web/src/app/app.component.ts`, `web/src/app/app.component.html`

- [ ] **Step 1: The page**

`settings.component.ts`:
```ts
import { Component } from '@angular/core';
import { MailSectionComponent } from './mail-section/mail-section.component';
import { ReportsSectionComponent } from './reports-section/reports-section.component';
import { AccountsSectionComponent } from './accounts-section/accounts-section.component';

/** Bank mail, email reports and the user's own accounts. Each section loads and saves on its own. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [MailSectionComponent, ReportsSectionComponent, AccountsSectionComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {}
```
`settings.component.html`:
```html
<div class="page-wrap">
  <div class="settings-header">
    <h1>Settings</h1>
    <p>Bank mail, email reports and your own accounts.</p>
  </div>
  <div class="settings-stack">
    <app-mail-section />
    <app-reports-section />
    <app-accounts-section />
  </div>
</div>
```
`settings.component.scss`:
```scss
.settings-header {
  margin-bottom: var(--space-md);
  h1 { margin: 0; }
  p { margin: 4px 0 0; font-size: 0.9rem; color: var(--text-muted); }
}

.settings-stack { display: flex; flex-direction: column; gap: var(--space-md); }
```

- [ ] **Step 2: Route, nav, gear link**

`app.routes.ts`: directly after the `tips` route, add:
```ts
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
```
Match the neighbouring routes' exact shape and indentation.

`app.component.ts`: after the Tips nav entry, add `{ label: 'Settings',     icon: 'settings',               path: '/settings' },`, aligned like its neighbours.

`app.component.html`: in the gear dropdown, directly before the `Edit Profile` link, add:
```html
              <a class="settings-item" routerLink="/settings" (click)="settingsOpen = false">
                <mat-icon>tune</mat-icon>
                Settings
              </a>
```

- [ ] **Step 3: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git diff HEAD -- web | grep -nE "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\()"; echo literal-done
```
Expected: `web-done` alone and `literal-done` alone.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/settings/settings.component.ts web/src/app/pages/settings/settings.component.html web/src/app/pages/settings/settings.component.scss web/src/app/app.routes.ts web/src/app/app.component.ts web/src/app/app.component.html
git commit -F- <<'EOF'
feat(web): the Settings page, in the sidebar and the gear menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

- After the **Cash envelopes** feature row, add:
```markdown
| **Settings** | See when bank mail was last read, check it now, dismiss mails that aren't transactions; turn the weekly and monthly emails on or off and choose where they go; edit the account numbers that tell your own transfers from spending |
```
- In the API table, after the `/api/cash/...` rows, add:
```markdown
| `GET` | `/api/settings` | Report and account settings, each saved or from the server's config |
| `PUT` | `/api/settings/reports` | `{ weekly, monthly, recipient }` |
| `PUT` | `/api/settings/accounts` | `{ cash, senders }` |
| `GET` | `/api/ingestion/status` | Last run, last failure, unreadable mails and what mail booked lately |
| `POST` | `/api/ingestion/run` | Check bank mail now (409 while a check runs) |
| `POST` | `/api/ingestion/unreadable/:id/dismiss` | Stop retrying a mail that isn't a transaction |
```
- Where the README documents `REPORT_TO`, `OWN_CASH_ACCOUNTS` or `OWN_ACCOUNT_IDENTIFIERS` (grep for them), add one sentence to each: "A value saved on the Settings page takes precedence; this is only the starting value."

- [ ] **Step 2: Suites and builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: api **52 suites / 555 tests**, build clean; web `web-done` alone.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add README.md
git commit -F- <<'EOF'
docs(readme): the Settings page and its endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format=%B -13 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```
Expected: `13`, and a clean tree. The controller runs the private-identifier check separately.

---

## After the tasks (controller)

1. Spec review, then code-quality review, then fixes. Then a preview-harness screenshot of the page (desktop and phone), the private-identifier gate, and the push.
2. Hand the user:
   - Restart `accounting-api` and `accounting-web` once CI is green.
   - Open **Settings**, check mail now, review the account lists, and save each section once.
   - After saving, `REPORT_TO`, `OWN_CASH_ACCOUNTS` and `OWN_ACCOUNT_IDENTIFIERS` can be removed from the Secret.
