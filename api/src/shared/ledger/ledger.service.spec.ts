import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
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

  it('applies a signed delta with one atomic $inc and records history from the returned balance', async () => {
    const r = await service.apply(-250, 'expense', 'uber', 'tx1');
    expect(balanceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 1 },
      { $inc: { balance: -250 }, $set: { lastActivity: expect.any(Date) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
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
      { userId: 1 }, expect.objectContaining({ $inc: { balance: 100 } }), expect.objectContaining({ upsert: true }),
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
});
