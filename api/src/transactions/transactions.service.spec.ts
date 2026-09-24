import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TransactionsService } from './transactions.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NotFoundException, ConflictException } from '@nestjs/common';

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

const mockModel: any = {
  find:           jest.fn(function() { return this; }),
  sort:           jest.fn(function() { return this; }),
  skip:           jest.fn(function() { return this; }),
  limit:          jest.fn(function() { return this; }),
  select:         jest.fn(function() { return this; }),
  lean:           jest.fn().mockResolvedValue(mockTxs),
  countDocuments: jest.fn().mockResolvedValue(mockTxs.length),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
  create: jest.fn(),
};

const ledger = {
  apply: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }),
  reverse: jest.fn().mockResolvedValue({ previousBalance: 0, newBalance: 0 }),
};

const categoriesService = {
  list: jest.fn().mockResolvedValue([{ name: 'food' }, { name: 'other' }, { name: 'Gym' }]),
};

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Matches the userId: 1 baked into the update describe's `live()` fixture
    // (same pattern as ledger.service.spec.ts and ingestion.service.spec.ts).
    process.env.BOSS_USER_ID = '1';
    // clearAllMocks() wipes call history but keeps the resolved values below,
    // so every test starts from this same baseline unless it overrides one.
    mockModel.lean.mockResolvedValue(mockTxs);
    mockModel.countDocuments.mockResolvedValue(mockTxs.length);
    mockModel.findOneAndUpdate.mockResolvedValue(null);
    ledger.apply.mockResolvedValue({ previousBalance: 0, newBalance: 0 });
    ledger.reverse.mockResolvedValue({ previousBalance: 0, newBalance: 0 });
    categoriesService.list.mockResolvedValue([{ name: 'food' }, { name: 'other' }, { name: 'Gym' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: LedgerService, useValue: ledger },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('exportCsv', () => {
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

    it('excludes deleted rows and internal/unresolved transfers from expense queries', async () => {
      await service.findAll({ type: 'expense' });
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
    });

    it('excludes them from CSV export too', async () => {
      await service.exportCsv({ type: 'expense' });
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
    });

    it('includes internal transfers in an unfiltered listing', async () => {
      await service.findAll({});
      const [filter] = mockModel.find.mock.calls[0] as any[];
      expect(filter).not.toHaveProperty('transferKind');
    });

    // Soft-deleted rows stay in the collection (an email-sourced row must keep
    // its sourceMessageId) but must never be listed, counted or exported.
    it('excludes deleted rows from an unfiltered listing and its count', async () => {
      await service.findAll({});
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(NOT_DELETED));
      expect(mockModel.countDocuments).toHaveBeenCalledWith(expect.objectContaining(NOT_DELETED));
    });

    it('excludes deleted rows from an unfiltered export', async () => {
      await service.exportCsv({});
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(NOT_DELETED));
    });

    it('does not recategorise a deleted row', async () => {
      await service.setCategory('tx1', 'food');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'tx1', ...NOT_DELETED }),
        expect.anything(),
      );
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

  describe('create', () => {
    // Echoes the doc back the way Mongoose would, so doc.transactionName in the
    // service reflects the stored (lowercased) name, not the raw input.
    beforeEach(() => mockModel.create.mockImplementation((doc: any) => Promise.resolve({ _id: 'new1', ...doc })));

    it('stores an expense negative, via the enum, as source manual, and moves the balance', async () => {
      await service.create({ type: 'expense', amount: 150, name: 'Colmado', category: 'food' });
      expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
        transactionType: TransactionType.EXPENSE, amount: -150, transactionName: 'colmado', category: 'food', source: 'manual',
      }));
      expect(ledger.apply).toHaveBeenCalledWith(-150, 'expense', 'colmado', 'new1');
    });

    it('stores income positive', async () => {
      await service.create({ type: 'income', amount: 2000, name: 'Freelance', category: 'other' });
      expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({ transactionType: TransactionType.INCOME, amount: 2000 }));
      expect(ledger.apply).toHaveBeenCalledWith(2000, 'income', 'freelance', 'new1');
    });

    it('rejects a non-positive amount', async () => {
      await expect(service.create({ type: 'expense', amount: 0, name: 'x', category: 'food' })).rejects.toThrow(/amount/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      await expect(service.create({ type: 'expense', amount: 1, name: 'x', category: 'nope' })).rejects.toThrow(/category/);
    });

    it('rejects a blank name and a bad type', async () => {
      await expect(service.create({ type: 'expense', amount: 1, name: '  ', category: 'food' })).rejects.toThrow(/name/);
      await expect(service.create({ type: 'refund' as any, amount: 1, name: 'x', category: 'food' })).rejects.toThrow(/type/);
    });

    it('uses the provided timestamp, else now', async () => {
      await service.create({ type: 'expense', amount: 1, name: 'x', category: 'food', timestamp: '2026-09-01T12:00:00Z' });
      expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({ timestamp: new Date('2026-09-01T12:00:00Z') }));
    });
  });

  describe('update', () => {
    const live = (over: Partial<any> = {}) => ({
      _id: 't1', userId: 1, amount: -100, transactionName: 'old', category: 'food', transferKind: undefined, ...over,
    });
    beforeEach(() => {
      mockModel.findOne = jest.fn();
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
    });

    it('applies the net delta when an ordinary expense amount changes', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { amount: 130 });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't1', userId: 1, deletedAt: null, amount: -100, transferKind: null }),
        { $set: { amount: -130 } },
      );
      expect(ledger.apply).toHaveBeenCalledWith(-30, 'manual', 'old', 't1');
    });

    it('keeps the stored sign: income stays positive', async () => {
      mockModel.findOne.mockResolvedValue(live({ amount: 500 }));
      await service.update('t1', { amount: 450 });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't1', userId: 1, deletedAt: null, amount: 500, transferKind: null }),
        { $set: { amount: 450 } },
      );
      expect(ledger.apply).toHaveBeenCalledWith(-50, 'manual', 'old', 't1');
    });

    // These rows never moved the balance; editing them must not either.
    it('does not move the balance for an internal or unresolved row', async () => {
      for (const kind of ['internal', 'unresolved']) {
        ledger.apply.mockClear();
        mockModel.findOne.mockResolvedValue(live({ transferKind: kind }));
        await service.update('t1', { amount: 999 });
        expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ _id: 't1', userId: 1, deletedAt: null, amount: -100, transferKind: kind }),
          { $set: { amount: -999 } },
        );
        expect(ledger.apply).not.toHaveBeenCalled();
      }
    });

    it('edits name and category without touching the balance', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { name: ' Super ', category: 'other' });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't1', userId: 1, deletedAt: null, amount: -100, transferKind: null }),
        { $set: { transactionName: 'super', category: 'other', categoryNeedsReview: false } },
      );
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('looks up only live rows and 404s otherwise', async () => {
      mockModel.findOne.mockResolvedValue(null);
      await expect(service.update('gone', { name: 'x' })).rejects.toThrow(NotFoundException);
      expect(mockModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'gone', deletedAt: null }));
    });

    it('rejects an unknown category and a non-positive amount', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await expect(service.update('t1', { category: 'nope' })).rejects.toThrow(/category/);
      await expect(service.update('t1', { amount: -5 })).rejects.toThrow(/amount/);
    });

    // The guarded write is the concurrency protection: a delete, another edit or a
    // resolution changes deletedAt, amount or transferKind, the filter misses, and
    // no delta is applied for a row that no longer matches what we read.
    it('409s and applies nothing when the row changed between read and write', async () => {
      mockModel.findOne.mockResolvedValue(live());
      mockModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(service.update('t1', { amount: 130 })).rejects.toThrow(ConflictException);
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('restores the stored amount and rethrows when the ledger fails after the write', async () => {
      mockModel.findOne.mockResolvedValue(live());
      mockModel.findOneAndUpdate.mockResolvedValue({});
      mockModel.updateOne = jest.fn().mockResolvedValue({});
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.update('t1', { amount: 130 })).rejects.toThrow('ledger down');
      expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { amount: -100 } });
    });
  });

  describe('softDelete', () => {
    // One atomic findOneAndUpdate matching only a LIVE row. It returns the
    // pre-image, so the amount we reverse comes from the same operation that won
    // the race. Two concurrent deletes cannot both reverse the balance.
    beforeEach(() => { mockModel.findOneAndUpdate = jest.fn(); mockModel.deleteOne = jest.fn(); });

    it('marks the row deleted atomically and reverses the balance for an ordinary expense', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'uber', transferKind: undefined });
      await service.softDelete('t1');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't1', deletedAt: null }),
        { $set: { deletedAt: expect.any(Date) }, $unset: { recurringId: 1, recurringPeriod: 1 } },
      );
      expect(ledger.reverse).toHaveBeenCalledWith(-100, 'uber', 't1');
      expect(mockModel.deleteOne).not.toHaveBeenCalled();   // never a hard delete
    });

    // A deleted row must leave the partial unique index on
    // (userId, recurringId, recurringPeriod), or the bank email for that period
    // can never be recorded: its create collides with the deleted row and every
    // poll re-parses the mail. Unsetting the link is what frees the slot.
    it('unsets the recurring link so the period can be recorded again', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't2', amount: -20000, transactionName: 'rent', recurringId: 'r1', recurringPeriod: '2026-10' });
      await service.softDelete('t2');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $unset: { recurringId: 1, recurringPeriod: 1 } }),
      );
    });

    it('does not touch the balance for internal or unresolved rows', async () => {
      for (const kind of ['internal', 'unresolved']) {
        ledger.reverse.mockClear();
        mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -100, transferKind: kind });
        await service.softDelete('t1');
        expect(mockModel.findOneAndUpdate).toHaveBeenCalled();
        expect(ledger.reverse).not.toHaveBeenCalled();
      }
    });

    it('404s and reverses nothing when no live row matches (missing, deleted, or claimed by a concurrent delete)', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(service.softDelete('gone')).rejects.toThrow(NotFoundException);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'gone', deletedAt: null }),
        expect.anything(),
      );
      expect(ledger.reverse).not.toHaveBeenCalled();
    });
  });

  describe('resolveTransfer', () => {
    beforeEach(() => { mockModel.findOneAndUpdate = jest.fn(); });

    it('resolving to external applies the balance exactly once, by the stored sign', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -20000, transactionName: 'transfer' });
      await service.resolveTransfer('t1', 'external');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't1', transferKind: 'unresolved', deletedAt: null }),
        { $set: { transferKind: 'external' } },
      );
      expect(ledger.apply).toHaveBeenCalledTimes(1);
      expect(ledger.apply).toHaveBeenCalledWith(-20000, 'expense', 'transfer', 't1');
    });

    it('a positive unresolved row resolved external is income', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: 2000, transactionName: 'transferencia recibida' });
      await service.resolveTransfer('t1', 'external');
      expect(ledger.apply).toHaveBeenCalledWith(2000, 'income', 'transferencia recibida', 't1');
    });

    it('resolving to internal moves nothing', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1', amount: -20000 });
      await service.resolveTransfer('t1', 'internal');
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('404s when no live row exists', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue(null);
      mockModel.exists = jest.fn().mockResolvedValue(null);
      await expect(service.resolveTransfer('gone', 'external')).rejects.toThrow(NotFoundException);
      expect(mockModel.exists).toHaveBeenCalledWith(expect.objectContaining({ _id: 'gone', deletedAt: null }));
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    // The atomic update is the guard: a live row that is not unresolved (or was
    // resolved a moment ago by a racing request) matches nothing → 409.
    it('409s when the live row is not unresolved', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue(null);
      mockModel.exists = jest.fn().mockResolvedValue({ _id: 't1' });
      await expect(service.resolveTransfer('t1', 'external')).rejects.toThrow(ConflictException);
      expect(ledger.apply).not.toHaveBeenCalled();
    });

    it('rejects an unknown kind', async () => {
      await expect(service.resolveTransfer('t1', 'unresolved' as any)).rejects.toThrow(/kind/);
    });
  });

  describe('ledger failure rollback', () => {
    beforeEach(() => { mockModel.updateOne = jest.fn().mockResolvedValue({}); mockModel.deleteOne = jest.fn().mockResolvedValue({}); });

    // A manual row created milliseconds ago with no sourceMessageId may be hard-
    // deleted: leaving it would invite a DELETE that reverses a movement that never
    // happened. This is the one permitted hard delete, same as ingestion's rollback.
    it('create removes the new row when the ledger fails', async () => {
      mockModel.create.mockResolvedValue({ _id: 'new1', transactionName: 'colmado' });
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.create({ type: 'expense', amount: 10, name: 'Colmado', category: 'food' })).rejects.toThrow('ledger down');
      expect(mockModel.deleteOne).toHaveBeenCalledWith({ _id: 'new1' });
    });

    it('softDelete restores the row, including its recurring link, when the ledger fails', async () => {
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'rent', recurringId: 'r1', recurringPeriod: '2026-10' });
      ledger.reverse.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.softDelete('t1')).rejects.toThrow('ledger down');
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: 't1' },
        { $unset: { deletedAt: 1 }, $set: { recurringId: 'r1', recurringPeriod: '2026-10' } },
      );
    });

    it('softDelete restores a row with no recurring link without a $set', async () => {
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'x' });
      ledger.reverse.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.softDelete('t1')).rejects.toThrow('ledger down');
      expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $unset: { deletedAt: 1 } });
    });

    it('resolveTransfer puts the row back to unresolved when the ledger fails', async () => {
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'transfer' });
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.resolveTransfer('t1', 'external')).rejects.toThrow('ledger down');
      expect(mockModel.updateOne).toHaveBeenCalledWith({ _id: 't1' }, { $set: { transferKind: 'unresolved' } });
    });
  });
});
