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
    expect(csv.startsWith('Date,Name,Type,Category,Kind,Amount\n')).toBe(true);
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

  it('excludes internal and unresolved transfers from expense queries', async () => {
    await service.findAll({ type: 'expense' });
    expect(mockModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        transferKind: { $nin: ['internal', 'unresolved'] },
      }),
    );
  });

  it('excludes them from CSV export too', async () => {
    await service.exportCsv({ type: 'expense' });
    expect(mockModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        transferKind: { $nin: ['internal', 'unresolved'] },
      }),
    );
  });

  it('includes internal transfers in an unfiltered listing', async () => {
    await service.findAll({});
    const [filter] = mockModel.find.mock.calls[0] as any[];
    expect(filter).not.toHaveProperty('transferKind');
  });

  it('can list only unresolved transfers', async () => {
    await service.findAll({ transferKind: 'unresolved' });
    expect(mockModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ transferKind: 'unresolved' }),
    );
  });

  it('selects transferKind so the UI can display it', async () => {
    await service.findAll({});
    expect(mockModel.select).toHaveBeenCalledWith(
      expect.stringContaining('transferKind'),
    );
  });

  // The design says internal/unresolved rows stay visible in an unfiltered
  // export, but tagged — so a spreadsheet sum on Type=expense must not
  // include them.
  describe('Kind tagging', () => {
    it('exports a Kind column', async () => {
      const csv = await service.exportCsv({});
      const header = csv.split('\n')[0];
      expect(header).toContain('Kind');
    });

    it('labels internal transfers as transfer, not expense', async () => {
      mockModel.lean.mockResolvedValueOnce([
        {
          transactionName: 'Transfer to Savings',
          transactionType: 'Расход',
          amount: -500,
          timestamp: new Date('2026-05-15'),
          category: 'other',
          transferKind: 'internal',
        },
      ]);

      const csv = await service.exportCsv({});
      const row = csv.trim().split('\n')[1];

      expect(row).toContain('"transfer"');
      expect(row).toContain('"internal"');
      expect(row).not.toContain('"expense"');
    });

    it('leaves Kind empty for ordinary card transactions', async () => {
      const csv = await service.exportCsv({});
      const rows = csv.trim().split('\n').slice(1);
      // Groceries row carries no transferKind at all.
      expect(rows[0]).toContain('"food","","50.00"');
    });
  });
});
