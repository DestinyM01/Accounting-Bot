import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LedgerService } from './ledger.service';
import { Balance } from '../schemas/balance.schema';
import { BalanceHistory } from '../schemas/balance-history.schema';

describe('LedgerService', () => {
  let service: LedgerService;
  let balanceDoc: any;
  let balanceModel: any;
  let historyModel: any;

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceDoc = { userId: 1, balance: 1000, lastActivity: null, save: jest.fn().mockResolvedValue(undefined) };
    balanceModel = { findOne: jest.fn().mockResolvedValue(balanceDoc), create: jest.fn() };
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

  it('applies a signed delta and records history', async () => {
    const r = await service.apply(-250, 'expense', 'uber', 'tx1');
    expect(balanceDoc.balance).toBe(750);
    expect(balanceDoc.save).toHaveBeenCalled();
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1, previousBalance: 1000, newBalance: 750, delta: -250,
      reason: 'expense', transactionName: 'uber', transactionId: 'tx1',
    }));
    expect(r).toEqual({ previousBalance: 1000, newBalance: 750 });
  });

  it('reverse undoes a stored amount regardless of sign', async () => {
    await service.reverse(-300, 'x', 'tx2');   // stored expense
    expect(balanceDoc.balance).toBe(1300);
    await service.reverse(500, 'y', 'tx3');    // stored income
    expect(balanceDoc.balance).toBe(800);
    expect(historyModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'delete', delta: -500 }));
  });

  it('creates the balance document when none exists', async () => {
    balanceModel.findOne.mockResolvedValue(null);
    const created = { userId: 1, balance: 0, save: jest.fn().mockResolvedValue(undefined) };
    balanceModel.create.mockResolvedValue(created);
    await service.apply(100, 'income');
    expect(balanceModel.create).toHaveBeenCalledWith({ userId: 1, balance: 0 });
    expect(created.balance).toBe(100);
  });

  // Mirrors the bot and ingestion: a history write failure must never undo
  // or block the balance movement that already happened.
  it('swallows a history failure after the balance moved', async () => {
    historyModel.create.mockRejectedValue(new Error('down'));
    await expect(service.apply(-10, 'expense')).resolves.toEqual({ previousBalance: 1000, newBalance: 990 });
  });
});
