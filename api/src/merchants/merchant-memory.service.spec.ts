import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { MerchantMemoryService } from './merchant-memory.service';
import { MerchantCategory } from '../shared/schemas/merchant-category.schema';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CategoriesService } from '../categories/categories.service';

function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const row = (over: Record<string, unknown> = {}) => ({
  _id: 't1', source: 'email', amount: -10, merchant: 'PRIME VIDEO*2K3JD', transactionName: 'prime video*2k3jd', ...over,
});

/** The query for a merchant's rows: the user's live bank-mail expenses, no withdrawals, no own-account transfers. */
const MERCHANT_ROWS = {
  userId: 1,
  source: 'email',
  amount: { $lt: 0 },
  isWithdrawal: { $ne: true },
  transferKind: { $nin: ['internal', 'unresolved'] },
  deletedAt: null,
};

describe('MerchantMemoryService', () => {
  let service: MerchantMemoryService;
  let memoryModel: { updateOne: jest.Mock; find: jest.Mock; findOne: jest.Mock; create: jest.Mock; deleteOne: jest.Mock };
  let txModel: { find: jest.Mock; updateMany: jest.Mock };
  let categories: { list: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    memoryModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      create: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    txModel = { find: jest.fn(() => query([])), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) };
    // Active categories; 'gym' is absent because it was deleted.
    categories = {
      list: jest.fn().mockResolvedValue(['food', 'entertainment', 'transport', 'cash', 'other'].map((name) => ({ name }))),
    };
    const mod = await Test.createTestingModule({
      providers: [
        MerchantMemoryService,
        { provide: getModelToken(MerchantCategory.name), useValue: memoryModel },
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: CategoriesService, useValue: categories },
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
      transferKind: { $nin: ['internal', 'unresolved'] },
      deletedAt: null,
      _id: { $ne: 't1' },
    });
    expect(pending.select).toHaveBeenCalledWith('merchant transactionName');
    expect(txModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['t2', 't4'] }, categoryNeedsReview: true, deletedAt: null },
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

  it.each([['cash'], ['other']])('does not remember %s', async (category) => {
    await expect(service.learn(row(), category)).resolves.toBe(0);
    expect(memoryModel.updateOne).not.toHaveBeenCalled();
    expect(txModel.find).not.toHaveBeenCalled();
  });

  it('keys off merchant before transactionName', async () => {
    await service.learn(row({ merchant: 'SOME STORE', transactionName: 'prime video' }), 'food');
    expect(memoryModel.updateOne).toHaveBeenCalledWith(
      { userId: 1, key: 'some store' },
      { $set: { category: 'food', updatedAt: expect.any(Date) } },
      { upsert: true },
    );
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

  it('never hands ingestion a remembered cash or other', async () => {
    // A category deleted with a move into Other also moves its remembered merchants there.
    memoryModel.find.mockReturnValue(
      query([
        { key: 'some store', category: 'other' },
        { key: 'atm place', category: 'cash' },
        { key: 'prime video', category: 'entertainment' },
      ]),
    );
    const map = await service.all();
    expect([...map.entries()]).toEqual([['prime video', 'entertainment']]);
  });

  describe('list', () => {
    it('shows every remembered merchant with its booked rows, sorted by name', async () => {
      memoryModel.find.mockReturnValue(
        query([
          { _id: 'm2', key: 'some store', category: 'food', updatedAt: new Date('2026-09-20T12:00:00Z') },
          { _id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: new Date('2026-09-25T12:00:00Z') },
        ]),
      );
      const rows = query([
        { _id: 't1', merchant: 'PRIME VIDEO*2K3JD' },
        { _id: 't2', transactionName: 'prime video*9xq1' },
        { _id: 't3', merchant: 'SOME STORE #12' },
        { _id: 't4', merchant: 'ANOTHER SHOP' },
      ]);
      txModel.find.mockReturnValue(rows);
      await expect(service.list()).resolves.toEqual([
        { id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: new Date('2026-09-25T12:00:00Z'), rows: 2, usable: true },
        { id: 'm2', key: 'some store', category: 'food', updatedAt: new Date('2026-09-20T12:00:00Z'), rows: 1, usable: true },
      ]);
      expect(memoryModel.find).toHaveBeenCalledWith({ userId: 1 });
      expect(txModel.find).toHaveBeenCalledWith(MERCHANT_ROWS);
      expect(rows.select).toHaveBeenCalledWith('merchant transactionName');
    });

    it('shows a merchant with no booked rows and no date as 0 rows and a null date', async () => {
      memoryModel.find.mockReturnValue(query([{ _id: 'm1', key: 'uber trip', category: 'transport' }]));
      await expect(service.list()).resolves.toEqual([
        { id: 'm1', key: 'uber trip', category: 'transport', updatedAt: null, rows: 0, usable: true },
      ]);
    });

    it.each([
      ['a deleted category', 'gym'],
      ['cash', 'cash'],
      ['other', 'other'],
    ])('marks a merchant remembered as %s as not usable', async (_label, category) => {
      memoryModel.find.mockReturnValue(query([{ _id: 'm1', key: 'some store', category, updatedAt: null }]));
      const [m] = await service.list();
      expect(m.usable).toBe(false);
    });
  });

  describe('match', () => {
    it('previews the key a typed name produces, its booked rows and the category already remembered', async () => {
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }, { _id: 't2', merchant: 'UBER *EATS' }]));
      memoryModel.findOne.mockReturnValue(query({ category: 'transport' }));
      await expect(service.match('Uber *Trip 99Z')).resolves.toEqual({ key: 'uber trip', rows: 1, remembered: 'transport' });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ userId: 1, key: 'uber trip' });
      expect(txModel.find).toHaveBeenCalledWith(MERCHANT_ROWS);
    });

    it('says nothing is remembered for a new merchant', async () => {
      await expect(service.match('UBER *TRIP')).resolves.toEqual({ key: 'uber trip', rows: 0, remembered: null });
    });

    it.each([
      ['only codes', '12345 #99'],
      ['a parser placeholder', 'Transferencia'],
      ['a generic word', 'PAYPAL'],
      ['a missing name', undefined],
      ['a repeated query parameter', ['uber', 'trip']],
      ['an over-long name', 'x'.repeat(201)],
    ])('gives an empty key for %s, without querying', async (_label, name) => {
      await expect(service.match(name)).resolves.toEqual({ key: '', rows: 0, remembered: null });
      expect(txModel.find).not.toHaveBeenCalled();
      expect(memoryModel.findOne).not.toHaveBeenCalled();
    });
  });
});
