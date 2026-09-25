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

  describe('reset', () => {
    it('forgets the saved reports section, so it follows the server config again', async () => {
      await service.resetReports();
      expect(model.updateOne).toHaveBeenCalledWith({ userId: 1 }, { $unset: { reports: '' } });
    });

    it('forgets the saved accounts section', async () => {
      await service.resetAccounts();
      expect(model.updateOne).toHaveBeenCalledWith({ userId: 1 }, { $unset: { accounts: '' } });
    });

    it('answers the refreshed view', async () => {
      process.env.OWN_CASH_ACCOUNTS = '2001,2002';
      const view = await service.resetAccounts();
      expect(view.accounts.cash).toEqual({ value: ['2001', '2002'], source: 'config' });
    });
  });

  // Pins the inclusive edges of every limit so a reviewer tightening an
  // off-by-one (e.g. `<= 3` instead of `< 3`) fails a test instead of silently
  // rejecting valid input.
  it('accepts the boundaries', async () => {
    await expect(service.saveAccounts({ cash: [], senders: ['abc', 'a'.repeat(40)] })).resolves.toBeDefined();
    await expect(
      service.saveAccounts({ cash: Array.from({ length: 20 }, (_, i) => String(1000 + i)), senders: [] }),
    ).resolves.toBeDefined();
    await expect(
      service.saveReports({ weekly: true, monthly: true, recipient: `${'a'.repeat(242)}@example.com` }),
    ).resolves.toBeDefined();
  });
});
