import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
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

    it('feeds CategorySpendService\'s breakdown to Mistral', async () => {
      spend.byCategory.mockResolvedValue([{ category: 'food', total: 3200 }]);
      await service.getTips();
      const complete = (service as any).client.chat.complete as jest.Mock;
      expect(complete.mock.calls[0][0].messages[1].content).toContain('  food: $3200.00');
    });

    // Mistral answers 429 when the account's plan allows 0 requests/minute.
    // That is an account problem, not ours, so it must not surface as a bare 500.
    it('reports a rate-limited Mistral account as 503, not 500', async () => {
      (service as any).client.chat.complete = jest.fn().mockRejectedValue({
        statusCode: 429,
        message: 'API error occurred: Status 429',
      });

      await expect(service.getTips()).rejects.toThrow(ServiceUnavailableException);
      await expect(service.getTips()).rejects.toThrow(/rate-limited/);
    });

    it('still reports any other Mistral failure as a generic 500', async () => {
      (service as any).client.chat.complete = jest.fn().mockRejectedValue(new Error('boom'));

      await expect(service.getTips()).rejects.toThrow(InternalServerErrorException);
    });
  });
});
