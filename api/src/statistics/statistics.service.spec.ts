import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StatisticsService } from './statistics.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const mockModel = {
  find:   jest.fn(function() { return this; }),
  select: jest.fn(function() { return this; }),
  lean:   jest.fn().mockResolvedValue([]),
};

describe('StatisticsService', () => {
  let service: StatisticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatisticsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<StatisticsService>(StatisticsService);
  });

  describe('summary', () => {
    it('excludes internal and unresolved transfers from income/expense totals', async () => {
      await service.summary(8, 2026);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          transferKind: { $nin: ['internal', 'unresolved'] },
        }),
      );
    });
  });

  describe('monthly', () => {
    it('excludes internal and unresolved transfers for every month queried', async () => {
      await service.monthly();
      expect(mockModel.find).toHaveBeenCalled();
      (mockModel.find.mock.calls as any[][]).forEach(([filter]) => {
        expect(filter).toEqual(
          expect.objectContaining({
            transferKind: { $nin: ['internal', 'unresolved'] },
          }),
        );
      });
    });
  });

  describe('byCategory', () => {
    it('excludes internal and unresolved transfers from the category breakdown', async () => {
      await service.byCategory(8, 2026);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          transferKind: { $nin: ['internal', 'unresolved'] },
        }),
      );
    });
  });
});
