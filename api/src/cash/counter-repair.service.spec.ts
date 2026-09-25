import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { CounterRepairService } from './counter-repair.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';

const W = '64b0000000000000000000a1';
function query(result: unknown) {
  const q: any = { lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}
const withdrawal = (over: Record<string, unknown> = {}) => ({
  _id: W, userId: 1, amount: -5000, isWithdrawal: true, allocatedCash: 4500, ...over,
});

describe('CounterRepairService', () => {
  let service: CounterRepairService;
  let txModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let itemModel: { find: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { findOne: jest.fn(() => query(withdrawal())), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    itemModel = { find: jest.fn(() => query([{ amount: 3000 }])) };
    const mod = await Test.createTestingModule({
      providers: [
        CounterRepairService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
      ],
    }).compile();
    service = mod.get(CounterRepairService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lowers a counter above its items to their sum, guarded on the value read', async () => {
    await expect(service.repair(W)).resolves.toBe(true);
    expect(txModel.findOne).toHaveBeenCalledWith({ _id: W, userId: 1, deletedAt: null });
    expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: W });
    expect(txModel.updateOne).toHaveBeenCalledWith({ _id: W, userId: 1, allocatedCash: 4500 }, { $set: { allocatedCash: 3000 } });
  });

  it('leaves a counter within half a cent of its items alone', async () => {
    txModel.findOne.mockReturnValue(query(withdrawal({ allocatedCash: 3000.004 })));
    await expect(service.repair(W)).resolves.toBe(false);
    expect(txModel.updateOne).not.toHaveBeenCalled();
  });

  it('reports no repair when the guarded write missed', async () => {
    txModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(service.repair(W)).resolves.toBe(false);
  });

  it.each([
    ['a missing withdrawal', null],
    ['an ordinary expense', withdrawal({ isWithdrawal: false })],
    ['an internal transfer', withdrawal({ transferKind: 'internal' })],
  ])('never touches %s', async (_label, row) => {
    txModel.findOne.mockReturnValue(query(row));
    await expect(service.repair(W)).resolves.toBe(false);
    expect(txModel.updateOne).not.toHaveBeenCalled();
  });
});
