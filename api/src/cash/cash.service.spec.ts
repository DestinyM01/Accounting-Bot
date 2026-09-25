import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Error as MongooseError, Types, mongo } from 'mongoose';
import { CashService } from './cash.service';
import { CashModule } from './cash.module';
import { CounterRepairService } from './counter-repair.service';
import { LedgerModule } from '../shared/ledger/ledger.module';
import { LedgerService } from '../shared/ledger/ledger.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { CategoriesService } from '../categories/categories.service';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

const W = '64b0000000000000000000a1';
const ITEM = '64b0000000000000000000b1';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { sort: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const withdrawal = (over: Record<string, unknown> = {}) => ({
  _id: W, userId: 1, transactionName: 'cajero automatico', timestamp: new Date('2026-09-20T15:00:00Z'),
  amount: -5000, isWithdrawal: true, allocatedCash: 4500, ...over,
});

describe('CashService', () => {
  let service: CashService;
  let txModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
  let itemModel: { find: jest.Mock; create: jest.Mock; findOneAndDelete: jest.Mock };
  let categories: { assertValid: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = {
      findOne: jest.fn(() => query(withdrawal())),
      findOneAndUpdate: jest.fn().mockResolvedValue(withdrawal()),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    itemModel = {
      find: jest.fn(() => query([])),
      create: jest.fn().mockResolvedValue({ _id: ITEM }),
      findOneAndDelete: jest.fn(() => query(null)),
    };
    categories = {
      assertValid: jest.fn(async (c: string) => {
        if (!['food', 'transport', 'cash'].includes(c)) throw new BadRequestException(`unknown category: ${c}`);
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CashService,
        CounterRepairService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
        { provide: CategoriesService, useValue: categories },
      ],
    }).compile();
    service = mod.get(CashService);
  });

  describe('breakdown', () => {
    it("computes what's allocated and left from the items, oldest first", async () => {
      const items = query([
        { _id: 'i1', category: 'food', amount: 3000, description: 'groceries' },
        { _id: 'i2', category: 'transport', amount: 1500 },
      ]);
      itemModel.find.mockReturnValue(items);
      // The counter can sit high after a crash; the breakdown must still read the items.
      txModel.findOne.mockReturnValue(query(withdrawal({ allocatedCash: 4800 })));
      expect(await service.breakdown(W)).toEqual({
        id: W, name: 'cajero automatico', timestamp: new Date('2026-09-20T15:00:00Z'),
        amount: 5000, allocated: 4500, remaining: 500,
        items: [
          { id: 'i1', category: 'food', description: 'groceries', amount: 3000 },
          { id: 'i2', category: 'transport', description: null, amount: 1500 },
        ],
      });
      expect(txModel.findOne).toHaveBeenCalledWith({ _id: W, userId: 1, deletedAt: null });
      expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: W });
      expect(items.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    });

    it('is a 404 for a missing or deleted row, or anything but a spending withdrawal', async () => {
      txModel.findOne.mockReturnValueOnce(query(null));
      await expect(service.breakdown(W)).rejects.toThrow(NotFoundException);
      await expect(service.breakdown('nope')).rejects.toThrow(NotFoundException);
      txModel.findOne.mockReturnValueOnce(query(withdrawal({ isWithdrawal: false })));
      await expect(service.breakdown(W)).rejects.toThrow(NotFoundException);
    });
  });

  describe('add', () => {
    it('reserves the amount on the withdrawal in one guarded write, then records the item', async () => {
      const result = await service.add(W, { category: 'food', amount: 300, description: '  groceries ' });
      expect(result.id).toBe(String(itemModel.create.mock.calls[0][0]._id));
      expect(txModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: W, userId: 1, isWithdrawal: true, amount: { $lt: 0 }, ...SPENDING_ONLY,
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ['$allocatedCash', 0] }, 300] },
              { $add: [{ $abs: '$amount' }, 0.005] },
            ],
          },
        },
        { $inc: { allocatedCash: 300 } },
        { new: true },
      );
      expect(itemModel.create).toHaveBeenCalledWith({
        _id: expect.any(Types.ObjectId), userId: 1, withdrawalId: W, category: 'food', amount: 300, description: 'groceries',
      });
      expect(txModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(itemModel.create.mock.invocationCallOrder[0]);
    });

    it('rounds the amount to cents and drops an empty description', async () => {
      await service.add(W, { category: 'food', amount: 12.3456, description: '   ' });
      expect(itemModel.create).toHaveBeenCalledWith({ _id: expect.any(Types.ObjectId), userId: 1, withdrawalId: W, category: 'food', amount: 12.35 });
    });

    it('refuses more than is left, naming what is left, and records nothing', async () => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      itemModel.find.mockReturnValue(query([{ amount: 3000 }, { amount: 1500 }])); // the counter (4500) is right
      await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
      expect(itemModel.create).not.toHaveBeenCalled();
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });

    it('is a 404 for a missing or deleted withdrawal', async () => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      txModel.findOne.mockReturnValue(query(null));
      await expect(service.add(W, { category: 'food', amount: 10 })).rejects.toThrow(NotFoundException);
      await expect(service.add('nope', { category: 'food', amount: 10 })).rejects.toThrow(NotFoundException);
      expect(itemModel.create).not.toHaveBeenCalled();
    });

    it.each([
      ['an ordinary expense', { isWithdrawal: false }],
      ['an internal transfer', { transferKind: 'internal' }],
      ['an unresolved transfer', { transferKind: 'unresolved' }],
      ['money coming in', { amount: 5000 }],
    ])('refuses to itemize %s', async (_label, over) => {
      txModel.findOneAndUpdate.mockResolvedValueOnce(null);
      txModel.findOne.mockReturnValue(query(withdrawal(over)));
      await expect(service.add(W, { category: 'food', amount: 10 })).rejects.toThrow('Only a cash withdrawal can be itemized');
      expect(itemModel.create).not.toHaveBeenCalled();
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });

    it('refuses a missing or unknown category, and cash itself, writing nothing', async () => {
      await expect(service.add(W, { category: 'gone', amount: 10 })).rejects.toThrow(/unknown category/);
      await expect(service.add(W, { category: 'cash', amount: 10 })).rejects.toThrow(/left unitemized/);
      await expect(service.add(W, { amount: 10 })).rejects.toThrow(/category is required/);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([0, -5, NaN, Infinity, '5', 2e12, 0.004])('refuses the amount %p, writing nothing', async (amount) => {
      await expect(service.add(W, { category: 'food', amount })).rejects.toThrow(BadRequestException);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([42, 'x'.repeat(61)])('refuses the description %p, writing nothing', async (description) => {
      await expect(service.add(W, { category: 'food', amount: 10, description })).rejects.toThrow(BadRequestException);
      expect(txModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('hands the reservation back when the database refused the item', async () => {
      itemModel.create.mockRejectedValueOnce(new MongooseError.ValidationError());
      await expect(service.add(W, { category: 'food', amount: 300 })).rejects.toThrow();
      expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W }, { $inc: { allocatedCash: -300 } });
    });

    it('hands the reservation back when the server rejected the write', async () => {
      itemModel.create.mockRejectedValueOnce(new mongo.MongoServerError({ message: 'E11000 duplicate key', code: 11000 } as any));
      await expect(service.add(W, { category: 'food', amount: 300 })).rejects.toThrow('E11000');
      expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W }, { $inc: { allocatedCash: -300 } });
    });

    it('keeps the reservation when the write may have landed', async () => {
      itemModel.create.mockRejectedValueOnce(new Error('connection reset'));
      await expect(service.add(W, { category: 'food', amount: 300 })).rejects.toThrow('connection reset');
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });

    describe('a counter left high', () => {
      it('is corrected from the items, and the add goes through', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        txModel.findOneAndUpdate.mockResolvedValueOnce(null); // refused: the counter says 4500 of 5000 is taken…
        itemModel.find.mockReturnValue(query([{ amount: 3000 }])); // …but the items hold only 3000
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
        // The id is generated by the service itself (see the "reserves the amount…" test
        // above), not read back from itemModel.create's resolved value: only its shape matters here.
        await expect(service.add(W, { category: 'food', amount: 600 })).resolves.toEqual({ id: expect.any(String) });
        expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1, allocatedCash: 4500 }, { $set: { allocatedCash: 3000 } });
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(itemModel.create).toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('4500'));
        // The repair reads the live withdrawal and only this user's items.
        expect(txModel.findOne).toHaveBeenCalledWith({ _id: W, userId: 1, deletedAt: null });
        expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: W });
        warn.mockRestore();
      });

      it('is left alone when it matches the items: the usual refusal', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 4500 }]));
        await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
        expect(txModel.updateOne).not.toHaveBeenCalled();
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      });

      it('is left alone when the counter is within half a cent of the items: the usual refusal', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        txModel.findOne.mockReturnValue(query(withdrawal({ allocatedCash: 4500.004 })));
        itemModel.find.mockReturnValue(query([{ amount: 4500 }]));
        await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
        expect(txModel.updateOne).not.toHaveBeenCalled();
      });

      it('rounds the repaired value to cents', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        txModel.findOne.mockReturnValue(query(withdrawal({ allocatedCash: 1000 })));
        itemModel.find.mockReturnValue(query([{ amount: 0.1 }, { amount: 0.2 }]));
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
        await expect(service.add(W, { category: 'food', amount: 10 })).resolves.toEqual({ id: expect.any(String) });
        expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1, allocatedCash: 1000 }, { $set: { allocatedCash: 0.3 } });
      });

      it('is not retried when something else changed it first', async () => {
        txModel.findOneAndUpdate.mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 3000 }]));
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
        await expect(service.add(W, { category: 'food', amount: 600 })).rejects.toThrow('Only $500.00 is left to itemize');
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      });

      it('is repaired at most once: a second refusal is final', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        txModel.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        itemModel.find.mockReturnValue(query([{ amount: 3000 }]));
        txModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
        await expect(service.add(W, { category: 'food', amount: 2500 })).rejects.toThrow(BadRequestException);
        expect(txModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(txModel.updateOne).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });
    });
  });

  describe('remove', () => {
    it('deletes the item, then gives its amount back to the withdrawal', async () => {
      itemModel.findOneAndDelete.mockReturnValueOnce(query({ _id: ITEM, withdrawalId: W, amount: 1500 }));
      await service.remove(ITEM);
      expect(itemModel.findOneAndDelete).toHaveBeenCalledWith({ _id: ITEM, userId: 1 });
      expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1 }, { $inc: { allocatedCash: -1500 } });
      expect(itemModel.findOneAndDelete.mock.invocationCallOrder[0]).toBeLessThan(txModel.updateOne.mock.invocationCallOrder[0]);
    });

    it('is a 404 for a missing item, and changes no counter', async () => {
      await expect(service.remove(ITEM)).rejects.toThrow(NotFoundException);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
      expect(txModel.updateOne).not.toHaveBeenCalled();
    });
  });

  // Items carry category weight only: the withdrawal already moved the balance.
  it('never touches the balance: no ledger in CashModule or CashService', () => {
    expect(Reflect.getMetadata('imports', CashModule)).not.toContain(LedgerModule);
    expect(Reflect.getMetadata('design:paramtypes', CashService)).not.toContain(LedgerService);
  });
});
