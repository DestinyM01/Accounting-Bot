import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TipsService } from './tips.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { CategorySpendService } from '../cash/category-spend.service';

const spend = { byCategory: jest.fn() };

let leanResult: any[] = [];

const mockModel = {
  find:   jest.fn(function () { return this; }),
  select: jest.fn(function () { return this; }),
  lean:   jest.fn(() => Promise.resolve(leanResult)),
};

describe('TipsService', () => {
  let service: TipsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    leanResult = [];
    spend.byCategory.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TipsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: CategorySpendService, useValue: spend },
      ],
    }).compile();
    service = module.get<TipsService>(TipsService);
    // Inject mock Mistral so tests don't need a real API key
    (service as any).client = {
      chat: {
        complete: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '[]' } }],
        }),
      },
    };
  });

  describe('getTips', () => {
    it("reads each of the last 3 months' categories from CategorySpendService", async () => {
      await service.getTips();
      expect(spend.byCategory).toHaveBeenCalledTimes(3);
      const now = new Date();
      for (let i = 2; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        expect(spend.byCategory).toHaveBeenCalledWith(start, new Date(start.getFullYear(), start.getMonth() + 1, 1));
      }
    });

    it('excludes deleted rows and internal/unresolved transfers from the average income query', async () => {
      await service.getTips();

      const calls = (mockModel.find as jest.Mock).mock.calls;
      const incomeCalls = calls.filter(([q]) => q.amount && q.amount.$gt !== undefined);
      expect(incomeCalls.length).toBe(1);
      expect(incomeCalls[0][0]).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });
});
