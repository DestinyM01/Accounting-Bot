import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { Balance } from '../schemas/balance.schema';
import { BalanceHistory } from '../schemas/balance-history.schema';

describe('LedgerService', () => {
  let service: LedgerService;
  let balanceModel: any;
  let historyModel: any;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOneAndUpdate: jest.fn().mockResolvedValue({ userId: 1, balance: 750 }) };
    historyModel = { create: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: getModelToken(BalanceHistory.name), useValue: historyModel },
      ],
    }).compile();
    service = mod.get(LedgerService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('applies a signed delta with one atomic $inc and records history from the returned balance', async () => {
    const r = await service.apply(-250, 'expense', 'uber', 'tx1');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 },
      { $inc: { balance: -250, seq: 1 }, $set: { lastActivity: expect.any(Date) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
  });

  it('stamps the history row with the sequence number from the same atomic write', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 750, seq: 42 });
    await service.apply(-250, 'expense', 'coffee', 't1');
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 42 }));
  });

  it('reverse undoes a stored amount regardless of sign', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 1300 });
    await service.reverse(-300, 'x', 'tx2');   // stored expense
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 800 });
    await service.reverse(500, 'y', 'tx3');    // stored income
    expect(historyModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'delete', delta: -500 }));
  });

  // upsert: a first-ever movement creates the document at 0 + delta.
  it('upserts the balance document when none exists', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValue({ userId: 1, balance: 100 });
    const r = await service.apply(100, 'income');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 }, expect.objectContaining({ $inc: { balance: 100, seq: 1 } }), expect.objectContaining({ upsert: true }),
    );
    expect(r).toEqual({ previousBalance: 0, newBalance: 100 });
  });

  // Mirrors the bot and ingestion: a history write failure must never undo
  // or block the balance movement that already happened. The balance moves
  // from 1000 to 990 in this one atomic step, same as before the $inc change.
  it('swallows a history failure after the balance moved', async () => {
    historyModel.create.mockRejectedValue(new Error('down'));
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 990 });
    await expect(service.apply(-10, 'expense')).resolves.toEqual({ previousBalance: 1000, newBalance: 990 });
  });

  describe('setTo', () => {
    it('sets an absolute total in one atomic write and records the difference as manual', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 52400 });
      const r = await service.setTo(51170, 'cash not tracked');
      expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { balance: 51170, lastActivity: expect.any(Date) }, $inc: { seq: 1 } },
        { upsert: true, new: false, setDefaultsOnInsert: true },
      );
      expect(historyModel.create).toHaveBeenCalledWith({
        userId: 1,
        previousBalance: 52400,
        newBalance: 51170,
        delta: -1230,
        reason: 'manual',
        transactionName: 'cash not tracked',
        seq: 1,
      });
      expect(r).toEqual({ previousBalance: 52400, newBalance: 51170, delta: -1230 });
    });

    it('numbers its row one past the pre-image', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 500, seq: 7 });
      await service.setTo(900, 'fix');
      expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { balance: 900, lastActivity: expect.any(Date) }, $inc: { seq: 1 } },
        expect.objectContaining({ new: false }),
      );
      expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 8 }));
    });

    it('records nothing when the total is unchanged', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 500 });
      const r = await service.setTo(500);
      expect(historyModel.create).not.toHaveBeenCalled();
      expect(r).toEqual({ previousBalance: 500, newBalance: 500, delta: 0 });
    });

    it('starts from zero when no balance exists yet', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce(null);
      const r = await service.setTo(100);
      expect(r).toEqual({ previousBalance: 0, newBalance: 100, delta: 100 });
      expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ previousBalance: 0, delta: 100 }));
    });

    it('rounds the difference to cents', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 0.1 });
      expect((await service.setTo(0.3)).delta).toBe(0.2);
    });

    it('keeps the correction when writing history fails', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 10 });
      historyModel.create.mockRejectedValueOnce(new Error('history down'));
      await expect(service.setTo(20)).resolves.toEqual({ previousBalance: 10, newBalance: 20, delta: 10 });
      expect(errorSpy).toHaveBeenCalledWith('Failed to record balance history', expect.stringContaining('history down'));
    });
  });
});
