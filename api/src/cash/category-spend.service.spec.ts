import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CategorySpendService } from './category-spend.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { CashAllocation } from '../shared/schemas/cash-allocation.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const FROM = new Date('2026-09-01T04:00:00Z');
const TO = new Date('2026-10-01T04:00:00Z');

describe('CategorySpendService', () => {
  let service: CategorySpendService;
  let txModel: { find: jest.Mock };
  let itemModel: { find: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { find: jest.fn(() => query([])) };
    itemModel = { find: jest.fn(() => query([])) };
    const mod = await Test.createTestingModule({
      providers: [
        CategorySpendService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(CashAllocation.name), useValue: itemModel },
      ],
    }).compile();
    service = mod.get(CategorySpendService);
  });

  it("reads the period's spending rows only", async () => {
    await service.byCategory(FROM, TO);
    expect(txModel.find).toHaveBeenCalledWith({
      userId: 1,
      timestamp: { $gte: FROM, $lt: TO },
      amount: { $lt: 0 },
      ...SPENDING_ONLY,
    });
  });

  it("reads only the items of the period's withdrawals, and applies them", async () => {
    txModel.find.mockReturnValue(
      query([
        { _id: 'w1', amount: -5000, category: 'cash', isWithdrawal: true },
        { _id: 't1', amount: -200, category: 'food' },
      ]),
    );
    itemModel.find.mockReturnValue(
      query([
        { withdrawalId: 'w1', amount: 3000, category: 'food' },
        { withdrawalId: 'w1', amount: 1500, category: 'transport' },
      ]),
    );
    const totals = await service.byCategory(FROM, TO);
    expect(itemModel.find).toHaveBeenCalledWith({ userId: 1, withdrawalId: { $in: ['w1'] } });
    expect(totals).toEqual([
      { category: 'food', total: 3200 },
      { category: 'transport', total: 1500 },
      { category: 'cash', total: 500 },
    ]);
  });

  it('skips the item query when the period has no withdrawals', async () => {
    txModel.find.mockReturnValue(query([{ _id: 't1', amount: -200, category: 'food' }]));
    expect(await service.byCategory(FROM, TO)).toEqual([{ category: 'food', total: 200 }]);
    expect(itemModel.find).not.toHaveBeenCalled();
  });
});
