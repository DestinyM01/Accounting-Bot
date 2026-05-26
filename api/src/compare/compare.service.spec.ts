import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CompareService } from './compare.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const MAY_TXS = [
  { amount: 1000, category: 'salary',    timestamp: new Date('2026-05-15') },
  { amount: -200, category: 'food',      timestamp: new Date('2026-05-10') },
  { amount: -150, category: 'transport', timestamp: new Date('2026-05-12') },
  { amount:  -50, category: 'food',      timestamp: new Date('2026-05-20') },
];

let leanResult: any[] = MAY_TXS;

const mockModel = {
  find:      jest.fn(function() { return this; }),
  select:    jest.fn(function() { return this; }),
  lean:      jest.fn(() => Promise.resolve(leanResult)),
  aggregate: jest.fn().mockResolvedValue([
    { _id: { year: 2026, month: 5 } },
    { _id: { year: 2026, month: 6 } },
  ]),
};

describe('CompareService', () => {
  let service: CompareService;

  beforeEach(async () => {
    jest.clearAllMocks();
    leanResult = MAY_TXS;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<CompareService>(CompareService);
    // Inject mock Mistral so tests don't need a real API key
    (service as any).client = {
      chat: {
        complete: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test analysis result' } }],
        }),
      },
    };
  });

  describe('getAvailableMonths', () => {
    it('returns YYYY-MM strings sorted chronologically', async () => {
      const months = await service.getAvailableMonths();
      expect(months).toEqual(['2026-05', '2026-06']);
    });

    it('pads single-digit months with a leading zero', async () => {
      const months = await service.getAvailableMonths();
      expect(months[0]).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('compare', () => {
    it('calculates totalIncome from positive amounts', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.totalIncome).toBe(1000);
    });

    it('calculates totalExpenses as sum of absolute negatives', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.totalExpenses).toBe(400);
    });

    it('calculates net as income minus expenses', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.net).toBe(600);
    });

    it('returns top categories sorted by amount descending', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.topCategories[0].category).toBe('food');
      expect(result.monthA.topCategories[0].amount).toBe(250);
    });

    it('includes at most 3 top categories', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.topCategories.length).toBeLessThanOrEqual(3);
    });

    it('attaches Mistral analysis to result', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.analysis).toBe('Test analysis result');
    });
  });
});
