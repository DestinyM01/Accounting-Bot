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

  it("never fails the user's change when filing the waiting rows fails", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    txModel.find.mockReturnValue(query([{ _id: 't2', merchant: 'PRIME VIDEO*9XQ1' }]));
    txModel.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.learn(row(), 'entertainment')).resolves.toBe(0);
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

    it('sorts accented names where a Spanish reader expects them', async () => {
      memoryModel.find.mockReturnValue(
        query([
          { _id: 'm1', key: 'oso shop', category: 'food', updatedAt: null },
          { _id: 'm2', key: 'ñame shop', category: 'food', updatedAt: null },
        ]),
      );
      const rows = await service.list();
      expect(rows.map((r) => r.key)).toEqual(['ñame shop', 'oso shop']);
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

    it('accepts a name of exactly 200 characters', async () => {
      await expect(service.match('a'.repeat(200))).resolves.toEqual({ key: 'a'.repeat(200), rows: 0, remembered: null });
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

  describe('add', () => {
    it('remembers a merchant typed by hand and files its rows waiting for review', async () => {
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      const waiting = query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }, { _id: 't2', merchant: 'UBER *EATS' }]);
      txModel.find.mockReturnValue(waiting);
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await expect(service.add('UBER *TRIP', 'transport')).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 1 });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ userId: 1, key: 'uber trip' });
      expect(memoryModel.create).toHaveBeenCalledWith({ userId: 1, key: 'uber trip', category: 'transport', updatedAt: expect.any(Date) });
      expect(txModel.find).toHaveBeenCalledWith({ ...MERCHANT_ROWS, categoryNeedsReview: true });
      expect(txModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['t1'] }, categoryNeedsReview: true, deletedAt: null },
        { $set: { category: 'transport', categoryNeedsReview: false } },
      );
    });

    it('reports the rows actually filed, not the rows found', async () => {
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      txModel.find.mockReturnValue(
        query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }, { _id: 't2', merchant: 'UBER *TRIP 9XQ1' }]),
      );
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await expect(service.add('UBER *TRIP', 'transport')).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 1 });
    });

    it('accepts a name of exactly 200 characters', async () => {
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      await service.add('a'.repeat(200), 'food');
      expect(memoryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a'.repeat(200) }),
      );
    });

    it("explains that Cash and Other are never remembered", async () => {
      const err = await service.add('UBER *TRIP', 'cash').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Cash and Other are never remembered');
    });

    it('names an inactive category in its 400', async () => {
      const err = await service.add('UBER *TRIP', 'gym').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('gym is not an active category');
    });

    it.each([
      ['an over-long name', 'x'.repeat(201), 'transport'],
      ['a name that is not text', 42, 'transport'],
      ['a name with no usable key', '#123 4X2', 'transport'],
      ['a deleted category', 'UBER *TRIP', 'gym'],
      ['cash', 'UBER *TRIP', 'cash'],
      ['other', 'UBER *TRIP', 'other'],
      ['a missing category', 'UBER *TRIP', undefined],
    ])('refuses %s with 400 and remembers nothing', async (_label, name, category) => {
      await expect(service.add(name, category)).rejects.toBeInstanceOf(BadRequestException);
      expect(memoryModel.create).not.toHaveBeenCalled();
      expect(memoryModel.findOne).not.toHaveBeenCalled();
    });

    it('answers 409 when the merchant is already remembered, and changes nothing', async () => {
      memoryModel.findOne.mockReturnValue(query({ category: 'food' }));
      const err = await service.add('UBER *TRIP', 'transport').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Already remembered as Food; change it in the list');
      expect(memoryModel.create).not.toHaveBeenCalled();
      expect(txModel.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 when a simultaneous add won the unique index', async () => {
      memoryModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      await expect(service.add('UBER *TRIP', 'transport')).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes any other database failure on', async () => {
      const failure = new Error('db down');
      memoryModel.create.mockRejectedValue(failure);
      await expect(service.add('UBER *TRIP', 'transport')).rejects.toBe(failure);
    });

    it('still answers when filing the waiting rows fails: logged, 0 filed', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      memoryModel.create.mockResolvedValue({ _id: 'm9' });
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'UBER *TRIP 4X2' }]));
      txModel.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.add('UBER *TRIP', 'transport')).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('change', () => {
    const ID = '64b000000000000000000001';

    beforeEach(() => {
      memoryModel.findOne.mockReturnValue(query({ _id: ID, key: 'prime video', category: 'food' }));
      memoryModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    });

    it("moves the merchant's rows still in the old category and its waiting rows, then the memory", async () => {
      const rows = query([
        { _id: 't1', merchant: 'PRIME VIDEO*2K3JD' },
        { _id: 't2', merchant: 'SOME STORE' },
        { _id: 't3', transactionName: 'prime video' },
      ]);
      txModel.find.mockReturnValue(rows);
      txModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
      await expect(service.change(ID, 'entertainment')).resolves.toEqual({ moved: 2 });
      expect(memoryModel.findOne).toHaveBeenCalledWith({ _id: ID, userId: 1 });
      expect(txModel.find).toHaveBeenCalledWith({ ...MERCHANT_ROWS, $or: [{ category: 'food' }, { categoryNeedsReview: true }] });
      expect(txModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['t1', 't3'] }, deletedAt: null, $or: [{ category: 'food' }, { categoryNeedsReview: true }] },
        { $set: { category: 'entertainment', categoryNeedsReview: false } },
      );
      expect(memoryModel.updateOne).toHaveBeenCalledWith(
        { _id: ID, userId: 1, category: { $in: ['food', 'entertainment'] } },
        { $set: { category: 'entertainment', updatedAt: expect.any(Date) } },
      );
    });

    it('reports the rows actually moved, not the rows found', async () => {
      txModel.find.mockReturnValue(
        query([
          { _id: 't1', merchant: 'PRIME VIDEO*2K3JD' },
          { _id: 't2', merchant: 'prime video*9xq1' },
        ]),
      );
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await expect(service.change(ID, 'entertainment')).resolves.toEqual({ moved: 1 });
    });

    it('moves the rows before it updates the memory, so a retry after a failure is safe', async () => {
      txModel.find.mockReturnValue(query([{ _id: 't1', merchant: 'PRIME VIDEO*2K3JD' }]));
      txModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await service.change(ID, 'entertainment');
      expect(txModel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(memoryModel.updateOne.mock.invocationCallOrder[0]);
    });

    it('updates only the memory when no row needs moving', async () => {
      await expect(service.change(ID, 'entertainment')).resolves.toEqual({ moved: 0 });
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).toHaveBeenCalled();
    });

    it('answers 409 when something changed the memory in between', async () => {
      memoryModel.updateOne.mockResolvedValue({ matchedCount: 0 });
      const err = await service.change(ID, 'entertainment').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('This merchant changed at the same time; some of its rows may have moved. Check the list and try again.');
    });

    it('writes nothing when the category is the same', async () => {
      await expect(service.change(ID, 'food')).resolves.toEqual({ moved: 0 });
      expect(txModel.find).not.toHaveBeenCalled();
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).not.toHaveBeenCalled();
    });

    it.each([['gym'], ['cash'], ['other'], [undefined]])('refuses %s with 400 and writes nothing', async (category) => {
      await expect(service.change(ID, category)).rejects.toBeInstanceOf(BadRequestException);
      expect(memoryModel.findOne).not.toHaveBeenCalled();
      expect(txModel.updateMany).not.toHaveBeenCalled();
      expect(memoryModel.updateOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a merchant no longer remembered', async () => {
      memoryModel.findOne.mockReturnValue(query(null));
      await expect(service.change(ID, 'entertainment')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 for a malformed id without querying', async () => {
      await expect(service.change('nope', 'entertainment')).rejects.toBeInstanceOf(NotFoundException);
      expect(memoryModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('forget', () => {
    const ID = '64b000000000000000000001';

    it('removes the memory and leaves every row alone', async () => {
      await expect(service.forget(ID)).resolves.toBeUndefined();
      expect(memoryModel.deleteOne).toHaveBeenCalledWith({ _id: ID, userId: 1 });
      expect(txModel.updateMany).not.toHaveBeenCalled();
    });

    it('is quiet when the merchant is already gone', async () => {
      memoryModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      await expect(service.forget(ID)).resolves.toBeUndefined();
    });

    it('is quiet for a malformed id, without querying', async () => {
      await expect(service.forget('nope')).resolves.toBeUndefined();
      expect(memoryModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
