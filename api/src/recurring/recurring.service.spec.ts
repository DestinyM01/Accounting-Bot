import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
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
  assertValid: jest.fn(async (c: string) => {
    if (!['food', 'other'].includes(c)) throw new BadRequestException(`unknown category: ${c}`);
  }),
};

describe('RecurringService', () => {
  let service: RecurringService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.BOSS_USER_ID = '1';
    mockModel.lean.mockResolvedValue([]);

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

    it('rejects a dayOfMonth outside 1..28 or non-integer', async () => {
      const ok = { type: 'expense' as const, amount: 1, name: 'x', category: 'food', dayOfMonth: 5 };
      await expect(service.create({ ...ok, dayOfMonth: 0 })).rejects.toThrow(/dayOfMonth/);
      await expect(service.create({ ...ok, dayOfMonth: 29 })).rejects.toThrow(/dayOfMonth/);
      await expect(service.create({ ...ok, dayOfMonth: 5.5 })).rejects.toThrow(/dayOfMonth/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('rejects a bad type or non-positive amount', async () => {
      const ok = { type: 'expense' as const, amount: 1, name: 'x', category: 'food', dayOfMonth: 5 };
      await expect(service.create({ ...ok, type: 'x' as any })).rejects.toThrow(/type/);
      await expect(service.create({ ...ok, amount: 0 })).rejects.toThrow(/amount/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown category or blank name', async () => {
      const ok = { type: 'expense' as const, amount: 1, name: 'x', category: 'food', dayOfMonth: 5 };
      await expect(service.create({ ...ok, category: 'nope' })).rejects.toThrow(/category/);
      await expect(service.create({ ...ok, name: ' ' })).rejects.toThrow(/name/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns each rule with the month the scheduler last handled, null when none', async () => {
      mockModel.lean.mockResolvedValue([
        {
          _id: 'r1', transactionName: 'rent', transactionType: TransactionType.EXPENSE, amount: 500, category: 'housing',
          dayOfMonth: 5, lastExecutedAt: new Date('2026-09-05T12:00:05Z'), lastPeriod: '2026-09',
        },
        { _id: 'r2', transactionName: 'salary', transactionType: TransactionType.INCOME, amount: 1000, category: 'salary', dayOfMonth: 25 },
      ]);
      const list = await service.list();
      expect(list.map((r) => r.lastPeriod)).toEqual(['2026-09', null]);
    });
  });
});
