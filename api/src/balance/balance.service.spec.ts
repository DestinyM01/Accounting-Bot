import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Balance } from '../shared/schemas/balance.schema';
import { BalanceHistory } from '../shared/schemas/balance-history.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { windowStart } from './daily-closings';
import { queryStub as query } from '../test-utils/query-stub';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-24T19:00:00Z');

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceModel: { findOne: jest.Mock };
  let historyModel: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock };
  let ledger: { setTo: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOne: jest.fn(() => query({ balance: 5000 })) };
    historyModel = {
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    ledger = { setTo: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0, delta: 0 }) };

    const mod = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: getModelToken(BalanceHistory.name), useValue: historyModel },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();
    service = mod.get(BalanceService);
  });

  describe('set', () => {
    it('sets through the ledger, rounded to cents, with a trimmed note', async () => {
      await service.set({ balance: 51170.456, note: '  cash not tracked  ' });
      expect(ledger.setTo).toHaveBeenCalledWith(51170.46, 'cash not tracked');
    });

    it('treats an empty note as none', async () => {
      await service.set({ balance: 10, note: '   ' });
      expect(ledger.setTo).toHaveBeenCalledWith(10, undefined);
    });

    it.each([
      ['a numeric string', '51170'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a total over 1e12', 2e12],
      ['a total under -1e12', -2e12],
      ['a missing total', undefined],
    ])('rejects %s', async (_label, bad) => {
      await expect(service.set({ balance: bad as any })).rejects.toBeInstanceOf(BadRequestException);
      expect(ledger.setTo).not.toHaveBeenCalled();
    });

    it('accepts exactly ±1e12 and negative totals', async () => {
      await service.set({ balance: 1e12 });
      await service.set({ balance: -1e12 });
      await service.set({ balance: -250.5 });
      expect(ledger.setTo.mock.calls.map((c) => c[0])).toEqual([1e12, -1e12, -250.5]);
    });

    it('measures the note after trimming it', async () => {
      await service.set({ balance: 1, note: `  ${'x'.repeat(100)}  ` });
      expect(ledger.setTo).toHaveBeenCalledWith(1, 'x'.repeat(100));
    });

    it('rejects a note that is not a string', async () => {
      await expect(service.set({ balance: 1, note: 5 as any })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a note over 100 characters', async () => {
      await expect(service.set({ balance: 1, note: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a 100-character note', async () => {
      await service.set({ balance: 1, note: 'x'.repeat(100) });
      expect(ledger.setTo).toHaveBeenCalledWith(1, 'x'.repeat(100));
    });
  });

  describe('history', () => {
    it('lists newest first, 20 by default, with names or null', async () => {
      const rows = [
        { _id: 'h1', timestamp: at('2026-09-24T15:00:00Z'), reason: 'expense', delta: -300, newBalance: 700, transactionName: 'uber' },
        { _id: 'h2', timestamp: at('2026-09-24T14:00:00Z'), reason: 'manual', delta: 500, newBalance: 1000 },
      ];
      const q = query(rows);
      historyModel.find.mockReturnValue(q);
      historyModel.countDocuments.mockResolvedValue(2);
      const page = await service.history({});
      expect(historyModel.find).toHaveBeenCalledWith({ userId: 1 });
      expect(q.sort).toHaveBeenCalledWith({ seq: -1, timestamp: -1, _id: -1 });
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(20);
      expect(page).toEqual({
        items: [
          { id: 'h1', timestamp: rows[0].timestamp, reason: 'expense', delta: -300, newBalance: 700, name: 'uber' },
          { id: 'h2', timestamp: rows[1].timestamp, reason: 'manual', delta: 500, newBalance: 1000, name: null },
        ],
        total: 2,
        nextCursor: null,
      });
    });

    it('clamps limit to 1..100 and offset to ≥ 0, falling back on junk', async () => {
      const q = query([]);
      historyModel.find.mockReturnValue(q);
      await service.history({ limit: '500', offset: '-3' });
      expect(q.limit).toHaveBeenLastCalledWith(100);
      expect(q.skip).toHaveBeenLastCalledWith(0);
      await service.history({ limit: 'abc', offset: '40' });
      expect(q.limit).toHaveBeenLastCalledWith(20);
      expect(q.skip).toHaveBeenLastCalledWith(40);
    });

    it('filters by kind in both the list and the total', async () => {
      await service.history({ reason: 'manual' });
      expect(historyModel.find).toHaveBeenCalledWith({ userId: 1, reason: 'manual' });
      expect(historyModel.countDocuments).toHaveBeenCalledWith({ userId: 1, reason: 'manual' });
    });

    it('rejects an unknown kind', async () => {
      await expect(service.history({ reason: 'refund' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('daily', () => {
    it('opens from the latest row before the window', async () => {
      const before = query({ newBalance: 800 });
      historyModel.findOne.mockReturnValue(before);
      const points = await service.daily({ days: '7' }, NOW);
      expect(historyModel.findOne).toHaveBeenCalledWith({ userId: 1, timestamp: { $lt: windowStart(NOW, 7) } });
      expect(before.sort).toHaveBeenCalledWith({ timestamp: -1, seq: -1, _id: -1 });
      expect(before.select).toHaveBeenCalledWith('newBalance');
      expect(points).toHaveLength(7);
      expect(points.every((p) => p.balance === 800)).toBe(true);
    });

    it("otherwise opens from the first window row's previous balance", async () => {
      historyModel.find.mockReturnValue(
        query([{ timestamp: at('2026-09-23T15:00:00Z'), newBalance: 900, previousBalance: 1000 }]),
      );
      const points = await service.daily({ days: '7' }, NOW);
      expect(points[0].balance).toBe(1000);
      expect(points[6].balance).toBe(900);
    });

    it('otherwise is flat at the live balance, or 0 without one', async () => {
      expect((await service.daily({ days: '7' }, NOW)).every((p) => p.balance === 5000)).toBe(true);
      balanceModel.findOne.mockReturnValue(query(null));
      expect((await service.daily({ days: '7' }, NOW)).every((p) => p.balance === 0)).toBe(true);
    });

    it('clamps days to 7..365, 90 by default', async () => {
      expect(await service.daily({ days: '3' }, NOW)).toHaveLength(7);
      expect(await service.daily({ days: '1000' }, NOW)).toHaveLength(365);
      expect(await service.daily({}, NOW)).toHaveLength(90);
    });

    it('prefers the row before the window over the first window row', async () => {
      historyModel.findOne.mockReturnValue(query({ newBalance: 800 }));
      historyModel.find.mockReturnValue(
        query([{ timestamp: at('2026-09-23T15:00:00Z'), newBalance: 900, previousBalance: 1000 }]),
      );
      const points = await service.daily({ days: '7' }, NOW);
      expect(points[0].balance).toBe(800);
    });

    it('reads the window from its start, oldest first', async () => {
      const rows = query([]);
      historyModel.find.mockReturnValue(rows);
      await service.daily({ days: '7' }, NOW);
      expect(historyModel.find).toHaveBeenCalledWith({ userId: 1, timestamp: { $gte: windowStart(NOW, 7) } });
      expect(rows.sort).toHaveBeenCalledWith({ timestamp: 1, seq: 1, _id: 1 });
      expect(rows.select).toHaveBeenCalledWith('timestamp newBalance previousBalance');
    });
  });

  describe('history paging and order', () => {
    it('orders by sequence, then time, then id', async () => {
      await service.history({});
      expect(historyModel.find.mock.results[0].value.sort).toHaveBeenCalledWith({ seq: -1, timestamp: -1, _id: -1 });
    });

    it('hands back an s-cursor for a numbered row and continues below it, older rows included', async () => {
      historyModel.find.mockReturnValueOnce(query(Array.from({ length: 2 }, (_, i) => ({
        _id: `64b0000000000000000000a${i}`, seq: 10 - i, timestamp: new Date('2026-09-20T15:00:00Z'), reason: 'expense', delta: -1, newBalance: 1,
      }))));
      const page = await service.history({ limit: '2' });
      expect(page.nextCursor).toBe('s9');
      await service.history({ limit: '2', before: 's9' });
      expect(historyModel.find.mock.calls[1][0]).toEqual({
        userId: 1,
        $or: [{ seq: { $lt: 9 } }, { seq: { $exists: false } }],
      });
    });

    it('continues among un-numbered rows by time and id, with the reason filter', async () => {
      await service.history({ before: 't2026-09-01T10:00:00.000Z_64b0000000000000000000a1', reason: 'manual' });
      expect(historyModel.find.mock.calls[0][0]).toEqual({
        userId: 1,
        reason: 'manual',
        seq: { $exists: false },
        $or: [
          { timestamp: { $lt: new Date('2026-09-01T10:00:00.000Z') } },
          { timestamp: new Date('2026-09-01T10:00:00.000Z'), _id: { $lt: expect.anything() } },
        ],
      });
    });

    it('answers 400 for a malformed cursor', async () => {
      await expect(service.history({ before: 'x1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('closes each day on its last change by sequence', async () => {
      await service.daily({});
      const sorts = historyModel.find.mock.results.map((r: any) => r.value.sort.mock.calls[0]?.[0]);
      expect(sorts).toContainEqual({ timestamp: 1, seq: 1, _id: 1 });
      expect(historyModel.findOne.mock.results[0].value.sort).toHaveBeenCalledWith({ timestamp: -1, seq: -1, _id: -1 });
    });
  });
});
