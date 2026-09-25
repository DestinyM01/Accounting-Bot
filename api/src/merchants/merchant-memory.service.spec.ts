import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { MerchantMemoryService } from './merchant-memory.service';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';

function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const row = (over: Record<string, unknown> = {}) => ({
  _id: 't1', source: 'email', amount: -10, merchant: 'PRIME VIDEO*2K3JD', transactionName: 'prime video*2k3jd', ...over,
});

describe('MerchantMemoryService', () => {
  let service: MerchantMemoryService;
  let memoryModel: { updateOne: jest.Mock; find: jest.Mock };
  let txModel: { find: jest.Mock; updateMany: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    memoryModel = { updateOne: jest.fn().mockResolvedValue({}), find: jest.fn(() => query([])) };
    txModel = { find: jest.fn(() => query([])), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) };
    const mod = await Test.createTestingModule({
      providers: [
        MerchantMemoryService,
        { provide: getModelToken(MerchantCategory.name), useValue: memoryModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
      ],
    }).compile();
    service = mod.get(MerchantMemoryService);
  });

  it("remembers the user's choice for the merchant; the last choice wins", async () => {
    await service.learn(row(), 'entertainment');
    expect(memoryModel.updateOne).toHaveBeenCalledWith(
      { userId: 1, key: 'prime video' },
      { $set: { category: 'entertainment', updatedAt: expect.any(Date) } },
      { upsert: true },
    );
  });

  it("files the same merchant's other rows still waiting for review, and says how many", async () => {
    const pending = query([
      { _id: 't2', merchant: 'PRIME VIDEO*9XQ1' },
      { _id: 't3', merchant: 'SOME STORE' },
      { _id: 't4', transactionName: 'prime video*zz7' },
    ]);
    txModel.find.mockReturnValue(pending);
    txModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
    await expect(service.learn(row(), 'entertainment')).resolves.toBe(2);
    expect(txModel.find).toHaveBeenCalledWith({
      userId: 1,
      source: 'email',
      categoryNeedsReview: true,
      amount: { $lt: 0 },
      isWithdrawal: { $ne: true },
      deletedAt: null,
      _id: { $ne: 't1' },
    });
    expect(pending.select).toHaveBeenCalledWith('merchant transactionName');
    expect(txModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['t2', 't4'] }, categoryNeedsReview: true },
      { $set: { category: 'entertainment', categoryNeedsReview: false } },
    );
  });

  it.each([
    ['income', { amount: 500 }],
    ['an ATM withdrawal', { isWithdrawal: true }],
    ['a transfer between own accounts', { transferKind: 'internal' }],
    ['an unresolved transfer', { transferKind: 'unresolved' }],
    ['a row not from bank mail', { source: 'manual' }],
    ['a merchant with no usable key', { merchant: '12345', transactionName: '12345' }],
  ])('learns nothing from %s', async (_label, over) => {
    await expect(service.learn(row(over), 'food')).resolves.toBe(0);
    expect(memoryModel.updateOne).not.toHaveBeenCalled();
    expect(txModel.updateMany).not.toHaveBeenCalled();
  });

  it("never fails the user's change: a failure is logged and counts 0", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    memoryModel.updateOne.mockRejectedValue(new Error('db down'));
    await expect(service.learn(row(), 'food')).resolves.toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('hands ingestion every remembered merchant', async () => {
    memoryModel.find.mockReturnValue(query([{ key: 'prime video', category: 'entertainment' }, { key: 'some store', category: 'food' }]));
    const map = await service.all();
    expect(memoryModel.find).toHaveBeenCalledWith({ userId: 1 });
    expect([...map.entries()]).toEqual([['prime video', 'entertainment'], ['some store', 'food']]);
  });
});
