import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TipsService } from './tips.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { SPENDING_ONLY } from '../shared/schemas/transfer-kind';

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TipsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
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
    // Internal transfers post as transactionType EXPENSE with a negative
    // amount — exactly the shape the 3-month category breakdown sums — so
    // without this exclusion they inflate the spending numbers fed to Mistral.
    it('excludes deleted rows and internal/unresolved transfers from the 3-month category breakdown query', async () => {
      await service.getTips();

      const calls = (mockModel.find as jest.Mock).mock.calls;
      const categoryCalls = calls.filter(([q]) => q.amount && q.amount.$lt !== undefined);
      expect(categoryCalls.length).toBe(3); // one per of the last 3 months
      for (const [q] of categoryCalls) {
        expect(q).toEqual(expect.objectContaining(SPENDING_ONLY));
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
