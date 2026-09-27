import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LedgerService } from './ledger.service';
import { TransactionRunner } from './transaction-runner';
import { FakeTransactionRunner } from '../../test-utils/fake-transaction-runner';
import { Balance } from '../schemas/balance.schema';
import { BalanceHistory } from '../schemas/balance-history.schema';

describe('LedgerService', () => {
  let service: LedgerService;
  let balanceModel: any;
  let historyModel: any;
  let runner: FakeTransactionRunner;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOneAndUpdate: jest.fn().mockResolvedValue({ userId: 1, balance: 750 }) };
    historyModel = { create: jest.fn().mockResolvedValue(undefined) };
    runner = new FakeTransactionRunner();

    const mod = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: getModelToken(BalanceHistory.name), useValue: historyModel },
        { provide: TransactionRunner, useValue: runner },
      ],
    }).compile();
    service = mod.get(LedgerService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('applies a signed delta with one atomic $inc and records history from the returned balance', async () => {
    const r = await runner.run(() => service.apply(-250, 'expense', 'uber', 'tx1'));
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 },
      { $inc: { balance: -250, seq: 1 }, $set: { lastActivity: expect.any(Date) } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
  });

  it('stamps the history row with the sequence number from the same atomic write', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 750, seq: 42 });
    await runner.run(() => service.apply(-250, 'expense', 'coffee', 't1'));
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 42 }));
  });

  it('reverse undoes a stored amount regardless of sign', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 1300 });
    await runner.run(() => service.reverse(-300, 'x', 'tx2'));   // stored expense
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 800 });
    await runner.run(() => service.reverse(500, 'y', 'tx3'));    // stored income
    expect(historyModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'delete', delta: -500 }));
  });

  // upsert: a first-ever movement creates the document at 0 + delta.
  it('upserts the balance document when none exists', async () => {
    balanceModel.findOneAndUpdate.mockResolvedValue({ userId: 1, balance: 100 });
    const r = await runner.run(() => service.apply(100, 'income'));
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 }, expect.objectContaining({ $inc: { balance: 100, seq: 1 } }), expect.objectContaining({ upsert: true }),
    );
    expect(r).toEqual({ previousBalance: 0, newBalance: 100 });
  });

  it('apply outside a transaction rejects and never touches the balance', async () => {
    await expect(service.apply(-10, 'expense')).rejects.toThrow(/only inside a transaction/);
    expect(balanceModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reverse outside a transaction rejects and never touches the balance', async () => {
    await expect(service.reverse(-10, 'x', 'tx')).rejects.toThrow(/only inside a transaction/);
    expect(balanceModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // A history failure is now inside the caller's transaction, so it must
  // propagate and abort the whole movement rather than being swallowed.
  it('a history failure propagates', async () => {
    const err = new Error('down');
    historyModel.create.mockRejectedValue(err);
    balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 990 });
    await expect(runner.run(() => service.apply(-10, 'expense'))).rejects.toBe(err);
  });

  describe('setTo', () => {
    it('sets an absolute total in one atomic write and records the difference as manual', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 52400 });
      const r = await runner.run(() => service.setTo(51170, 'cash not tracked'));
      expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { balance: 51170, lastActivity: expect.any(Date) }, $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'before', setDefaultsOnInsert: true },
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
      await runner.run(() => service.setTo(900, 'fix'));
      expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1 },
        { $set: { balance: 900, lastActivity: expect.any(Date) }, $inc: { seq: 1 } },
        expect.objectContaining({ returnDocument: 'before' }),
      );
      expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ seq: 8 }));
    });

    it('records nothing when the total is unchanged', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 500 });
      const r = await runner.run(() => service.setTo(500));
      expect(historyModel.create).not.toHaveBeenCalled();
      expect(r).toEqual({ previousBalance: 500, newBalance: 500, delta: 0 });
    });

    it('starts from zero when no balance exists yet', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce(null);
      const r = await runner.run(() => service.setTo(100));
      expect(r).toEqual({ previousBalance: 0, newBalance: 100, delta: 100 });
      expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ previousBalance: 0, delta: 100 }));
    });

    it('rounds the difference to cents', async () => {
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 0.1 });
      expect((await runner.run(() => service.setTo(0.3))).delta).toBe(0.2);
    });

    it('setTo outside a transaction rejects and never touches the balance', async () => {
      await expect(service.setTo(20)).rejects.toThrow(/only inside a transaction/);
      expect(balanceModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    // A history failure is now inside the caller's transaction, so it must
    // propagate and abort the whole correction rather than being swallowed.
    it('a history failure propagates', async () => {
      const err = new Error('history down');
      balanceModel.findOneAndUpdate.mockResolvedValueOnce({ userId: 1, balance: 10 });
      historyModel.create.mockRejectedValueOnce(err);
      await expect(runner.run(() => service.setTo(20))).rejects.toBe(err);
    });
  });
});
