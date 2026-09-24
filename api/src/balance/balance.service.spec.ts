import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Balance } from '../shared/schemas/balance.schema';
import { BalanceHistory } from '../shared/schemas/balance-history.schema';
import { LedgerService } from '../shared/ledger/ledger.service';
import { windowStart } from './daily-closings';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-24T19:00:00Z');

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = {
    select: jest.fn(() => q),
    sort: jest.fn(() => q),
    skip: jest.fn(() => q),
    limit: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return q;
}

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

    it('rejects anything but a finite number within ±1e12', async () => {
      for (const bad of ['51170', NaN, Infinity, 2e12, undefined]) {
        await expect(service.set({ balance: bad as any })).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(ledger.setTo).not.toHaveBeenCalled();
    });

    it('rejects a note that is not a string or longer than 100 characters', async () => {
      await expect(service.set({ balance: 1, note: 5 as any })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.set({ balance: 1, note: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
      await service.set({ balance: 1, note: 'x'.repeat(100) });
      expect(ledger.setTo).toHaveBeenCalledTimes(1);
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
      expect(q.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(20);
      expect(page).toEqual({
        items: [
          { id: 'h1', timestamp: rows[0].timestamp, reason: 'expense', delta: -300, newBalance: 700, name: 'uber' },
          { id: 'h2', timestamp: rows[1].timestamp, reason: 'manual', delta: 500, newBalance: 1000, name: null },
        ],
        total: 2,
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
      expect(before.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
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
  });
});
