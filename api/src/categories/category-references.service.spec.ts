import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CategoryReferencesService } from './category-references.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { Recurring } from '../shared/schemas/recurring.schema';
import { Budget } from '../shared/schemas/budget.schema';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

describe('CategoryReferencesService', () => {
  let service: CategoryReferencesService;
  let txModel: { aggregate: jest.Mock; updateMany: jest.Mock };
  let recurringModel: { aggregate: jest.Mock; updateMany: jest.Mock };
  let budgetModel: { aggregate: jest.Mock; find: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock; findOneAndDelete: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    txModel = { aggregate: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) };
    recurringModel = { aggregate: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) };
    budgetModel = {
      aggregate: jest.fn().mockResolvedValue([]),
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      updateOne: jest.fn().mockResolvedValue({}),
      findOneAndDelete: jest.fn(() => query(null)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CategoryReferencesService,
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(Recurring.name), useValue: recurringModel },
        { provide: getModelToken(Budget.name), useValue: budgetModel },
      ],
    }).compile();
    service = mod.get(CategoryReferencesService);
  });

  it('counts live transactions, active rules and budgets per category', async () => {
    txModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 12 }, { _id: 'food', n: 4 }]);
    recurringModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 1 }]);
    budgetModel.aggregate.mockResolvedValue([{ _id: 'gym', n: 2 }]);
    const usage = await service.usage();
    expect(usage.get('gym')).toEqual({ transactions: 12, recurring: 1, budgets: 2 });
    expect(usage.get('food')).toEqual({ transactions: 4, recurring: 0, budgets: 0 });
    expect(txModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, deletedAt: null } });
    expect(recurringModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1, active: true } });
    expect(budgetModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 1 } });
  });

  it('moves transactions and recurring rules by name, deleted and inactive ones included', async () => {
    await service.migrate('gym', 'health');
    expect(txModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
    expect(recurringModel.updateMany).toHaveBeenCalledWith({ userId: 1, category: 'gym' }, { $set: { category: 'health' } });
  });

  it('renames a budget when the target category has none that month', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    await service.migrate('gym', 'health');
    expect(budgetModel.findOne).toHaveBeenCalledWith({ userId: 1, category: 'health', month: 9, year: 2026 });
    expect(budgetModel.updateOne).toHaveBeenCalledWith({ _id: 'b1', category: 'gym' }, { $set: { category: 'health' } });
    expect(budgetModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  it("adds a budget into the target's for the same month, deleting it first", async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    budgetModel.findOne.mockReturnValue(query({ _id: 't1', limitAmount: 5000 }));
    budgetModel.findOneAndDelete.mockReturnValue(query({ _id: 'b1', limitAmount: 2000 }));
    await service.migrate('gym', 'health');
    expect(budgetModel.findOneAndDelete).toHaveBeenCalledWith({ _id: 'b1', category: 'gym' });
    expect(budgetModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $inc: { limitAmount: 2000 } });
    expect(budgetModel.findOneAndDelete.mock.invocationCallOrder[0]).toBeLessThan(
      budgetModel.updateOne.mock.invocationCallOrder[0],
    );
  });

  it('adds nothing when an earlier run already moved that budget', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    budgetModel.findOne.mockReturnValue(query({ _id: 't1', limitAmount: 7000 }));
    await service.migrate('gym', 'health'); // findOneAndDelete finds nothing
    expect(budgetModel.updateOne).not.toHaveBeenCalled();
  });

  it('only ever touches rows still under the old name', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    await service.migrate('gym', 'health');
    expect(budgetModel.find).toHaveBeenCalledWith({ userId: 1, category: 'gym' });
    for (const call of [...txModel.updateMany.mock.calls, ...recurringModel.updateMany.mock.calls, ...budgetModel.updateOne.mock.calls]) {
      expect(call[0]).toEqual(expect.objectContaining({ category: 'gym' }));
    }
  });

  it('does nothing when moving a name to itself', async () => {
    budgetModel.find.mockReturnValue(query([{ _id: 'b1', month: 9, year: 2026, limitAmount: 2000 }]));
    await service.migrate('gym', 'gym');
    expect(txModel.updateMany).not.toHaveBeenCalled();
    expect(budgetModel.find).not.toHaveBeenCalled();
    expect(budgetModel.findOneAndDelete).not.toHaveBeenCalled();
  });
});
