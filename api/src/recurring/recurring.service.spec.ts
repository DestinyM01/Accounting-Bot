import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RecurringService } from './recurring.service';
import { Recurring } from '../shared/schemas/recurring.schema';
import { CategoriesService } from '../categories/categories.service';
import { TransactionType } from '../shared/schemas/transaction-type.enum';

const mockModel: any = {
  find: jest.fn(function () { return this; }),
  sort: jest.fn(function () { return this; }),
  lean: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

const categoriesService = {
  list: jest.fn().mockResolvedValue([{ name: 'food' }, { name: 'other' }]),
};

describe('RecurringService', () => {
  let service: RecurringService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.BOSS_USER_ID = '1';
    mockModel.lean.mockResolvedValue([]);
    categoriesService.list.mockResolvedValue([{ name: 'food' }, { name: 'other' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringService,
        { provide: getModelToken(Recurring.name), useValue: mockModel },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();
    service = module.get<RecurringService>(RecurringService);
  });

  describe('create', () => {
    it('stores a positive amount, the enum type, and the day', async () => {
      mockModel.create.mockResolvedValue({ _id: 'r1' });
      await expect(service.create({ type: 'income', amount: 45000, name: 'Salary', category: 'other', dayOfMonth: 14 })).resolves.toEqual({ id: 'r1' });
      expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1, userName: 'web', transactionName: 'salary', transactionType: TransactionType.INCOME,
        amount: 45000, dayOfMonth: 14, category: 'other', active: true,
      }));
    });

    it('rejects day outside 1..28, bad type, non-positive amount, unknown category, blank name', async () => {
      const ok = { type: 'expense' as const, amount: 1, name: 'x', category: 'food', dayOfMonth: 5 };
      await expect(service.create({ ...ok, dayOfMonth: 0 })).rejects.toThrow(/dayOfMonth/);
      await expect(service.create({ ...ok, dayOfMonth: 29 })).rejects.toThrow(/dayOfMonth/);
      await expect(service.create({ ...ok, dayOfMonth: 5.5 })).rejects.toThrow(/dayOfMonth/);
      await expect(service.create({ ...ok, type: 'x' as any })).rejects.toThrow(/type/);
      await expect(service.create({ ...ok, amount: 0 })).rejects.toThrow(/amount/);
      await expect(service.create({ ...ok, category: 'nope' })).rejects.toThrow(/category/);
      await expect(service.create({ ...ok, name: ' ' })).rejects.toThrow(/name/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });
  });
});
