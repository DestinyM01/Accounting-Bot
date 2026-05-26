import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TransactionsService } from './transactions.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const mockTxs = [
  {
    transactionName: 'Groceries',
    transactionType: 'Расход',
    amount: -50,
    timestamp: new Date('2026-05-01'),
    category: 'food',
  },
  {
    transactionName: 'Salary',
    transactionType: 'Доход',
    amount: 1000,
    timestamp: new Date('2026-05-05'),
    category: 'salary',
  },
  {
    transactionName: 'He said, "lunch"',
    transactionType: 'Расход',
    amount: -20,
    timestamp: new Date('2026-05-10'),
    category: 'food',
  },
];

const mockModel = {
  find:           jest.fn(function() { return this; }),
  sort:           jest.fn(function() { return this; }),
  skip:           jest.fn(function() { return this; }),
  limit:          jest.fn(function() { return this; }),
  select:         jest.fn(function() { return this; }),
  lean:           jest.fn().mockResolvedValue(mockTxs),
  countDocuments: jest.fn().mockResolvedValue(mockTxs.length),
};

describe('TransactionsService.exportCsv', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  it('starts with the header row', async () => {
    const csv = await service.exportCsv({});
    expect(csv.startsWith('Date,Name,Type,Category,Amount\n')).toBe(true);
  });

  it('produces one data row per transaction', async () => {
    const csv = await service.exportCsv({});
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('marks negative amount as expense', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"expense"');
  });

  it('marks positive amount as income', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"income"');
  });

  it('outputs absolute amount with 2 decimals', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"50.00"');
    expect(csv).not.toContain('"-50"');
  });

  it('escapes double-quotes inside names', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"He said, ""lunch"""');
  });
});
