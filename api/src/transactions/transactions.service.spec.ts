import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TransactionsService } from './transactions.service';
import { Transaction } from '../shared/schemas/transaction.schema';
import { NOT_DELETED, SPENDING_ONLY } from '../shared/schemas/transfer-kind';
import { LedgerService } from '../shared/ledger/ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { MerchantMemoryService } from '../merchants/merchant-memory.service';
import { CounterRepairService } from '../cash/counter-repair.service';
import { TransactionType } from '../shared/schemas/transaction-type.enum';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

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
  assertValid: jest.fn(async (c: string) => {
    if (!['food', 'other', 'Gym'].includes(c)) throw new BadRequestException(`unknown category: ${c}`);
  }),
};

const memory = { learn: jest.fn().mockResolvedValue(0) };

const repair = { repair: jest.fn().mockResolvedValue(false) };

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
    memory.learn.mockResolvedValue(0);
    repair.repair.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: LedgerService, useValue: ledger },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: MerchantMemoryService, useValue: memory },
        { provide: CounterRepairService, useValue: repair },
      ],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('findAll', () => {
    it('excludes deleted rows and internal/unresolved transfers from expense queries', async () => {
      await service.findAll({ type: 'expense' });
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

    it('selects isWithdrawal and allocatedCash so the page can offer itemizing', async () => {
      await service.findAll({});
      const fields = (mockModel.select.mock.calls[0][0] as string).split(' ');
      expect(fields).toEqual(expect.arrayContaining(['isWithdrawal', 'allocatedCash']));
    });

    it('can list only withdrawals with cash left to itemize', async () => {
      await service.findAll({ unitemized: true });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          isWithdrawal: true,
          amount: { $lt: 0 },
          $expr: { $gt: [{ $abs: '$amount' }, { $add: [{ $ifNull: ['$allocatedCash', 0] }, 0.005] }] },
        }),
      );
    });

    it('combines the unitemized filter with the others instead of overriding them', async () => {
      await service.findAll({ type: 'income', unitemized: true });
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining({ amount: { $gt: 0, $lt: 0 } }));
    });

    it("filters by whole calendar days in the user's zone", async () => {
      await service.findAll({ startDate: '2026-09-01', endDate: '2026-09-30' });
      const [filter] = mockModel.find.mock.calls[0] as any[];
      expect(filter.timestamp.$gte.toISOString()).toBe('2026-09-01T04:00:00.000Z');
      expect(filter.timestamp.$lte.toISOString()).toBe('2026-10-01T03:59:59.999Z');
    });

    it('refuses a malformed date', async () => {
      await expect(service.findAll({ startDate: 'sept' })).rejects.toThrow(BadRequestException);
      await expect(service.findAll({ endDate: '2026-9-30' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll paging', () => {
    it('sorts by time then id, and hands back a cursor after a full page', async () => {
      const rows = [
        { _id: '64b0000000000000000000a2', timestamp: new Date('2026-09-20T15:00:00Z'), amount: -10 },
        { _id: '64b0000000000000000000a1', timestamp: new Date('2026-09-20T15:00:00Z'), amount: -20 },
      ];
      mockModel.lean.mockResolvedValue(rows);
      mockModel.countDocuments.mockResolvedValue(5);
      const page = await service.findAll({ limit: 2 });
      expect(mockModel.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
      expect(page.nextCursor).toBe('2026-09-20T15:00:00.000Z_64b0000000000000000000a1');
    });

    it('says there is no next page after a short page', async () => {
      mockModel.lean.mockResolvedValue([{ _id: '64b0000000000000000000a1', timestamp: new Date(), amount: -1 }]);
      const page = await service.findAll({ limit: 20 });
      expect(page.nextCursor).toBeNull();
    });

    it('continues after a cursor, combined with the filters, without skipping', async () => {
      await service.findAll({ limit: 20, before: '2026-09-20T15:00:00.000Z_64b0000000000000000000a1', needsReview: true });
      const filter = mockModel.find.mock.calls[0][0];
      expect(filter.$and).toEqual([
        expect.objectContaining({ categoryNeedsReview: true }),
        { $or: [
          { timestamp: { $lt: new Date('2026-09-20T15:00:00.000Z') } },
          { timestamp: new Date('2026-09-20T15:00:00.000Z'), _id: { $lt: expect.anything() } },
        ] },
      ]);
      expect(mockModel.skip).not.toHaveBeenCalled();
    });

    it('answers 400 for a malformed cursor', async () => {
      await expect(service.findAll({ before: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setCategory', () => {
    it('does not recategorise a deleted row', async () => {
      await service.setCategory('tx1', 'food');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'tx1', ...NOT_DELETED }),
        expect.anything(),
      );
    });

    // setCategory — the pre-existing PATCH skipped the allow-list entirely
    it('setCategory rejects an unknown category', async () => {
      await expect(service.setCategory('t1', 'nope')).rejects.toThrow(/category/);
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('teaches the memory from the row as it was, and reports what else it filed', async () => {
      const before = { _id: 'tx1', source: 'email', amount: -10, merchant: 'PRIME VIDEO*2K3JD', categoryNeedsReview: true };
      mockModel.findOneAndUpdate.mockResolvedValueOnce(before);
      memory.learn.mockResolvedValueOnce(1);
      await expect(service.setCategory('tx1', 'food')).resolves.toEqual({ alsoFiled: 1 });
      expect(memory.learn).toHaveBeenCalledWith(before, 'food');
    });

    it('files nothing for a row that no longer exists', async () => {
      mockModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(service.setCategory('tx1', 'food')).resolves.toEqual({ alsoFiled: 0 });
      expect(memory.learn).not.toHaveBeenCalled();
    });
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

    it('excludes them from CSV export too', async () => {
      await service.exportCsv({ type: 'expense' });
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(SPENDING_ONLY));
    });

    it('excludes deleted rows from an unfiltered export', async () => {
      await service.exportCsv({});
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining(NOT_DELETED));
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

    // The api now runs in the user's zone: an evening purchase must keep its
    // own calendar day, not roll to the next day because the date printed was UTC.
    it('prints the local date, not the UTC date, for a row late in the user evening', async () => {
      mockModel.lean.mockResolvedValueOnce([
        {
          transactionName: 'Late dinner',
          transactionType: 'Расход',
          amount: -50,
          timestamp: new Date('2026-09-25T01:53:00Z'),
          category: 'food',
        },
      ]);

      const csv = await service.exportCsv({});
      const row = csv.trim().split('\n')[1];

      expect(row).toContain('"2026-09-24"');
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

    it('rejects an invalid timestamp', async () => {
      await expect(service.create({ type: 'expense', amount: 1, name: 'x', category: 'food', timestamp: 'not-a-date' })).rejects.toThrow(/timestamp/);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    // Category names are exact: custom categories keep their case ('Gym'), and
    // the allow-list is the stored spelling, so 'gym' must not pass.
    it('matches categories exactly, including case', async () => {
      mockModel.create.mockResolvedValue({ _id: 'n', transactionName: 'x' });
      await expect(service.create({ type: 'expense', amount: 1, name: 'x', category: 'Gym' })).resolves.toEqual({ id: 'n' });
      await expect(service.create({ type: 'expense', amount: 1, name: 'x', category: 'gym' })).rejects.toThrow(/category/);
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

    it('teaches the memory when the edit changes the category', async () => {
      const before = live({ source: 'email', merchant: 'SOME STORE' });
      mockModel.findOne.mockResolvedValue(before);
      await service.update('t1', { category: 'other' });
      expect(memory.learn).toHaveBeenCalledWith(before, 'other');
    });

    it('teaches nothing when the edit leaves the category alone', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { name: 'renamed' });
      expect(memory.learn).not.toHaveBeenCalled();
    });

    // The web edit form always sends `category`, even when only the name
    // changed — re-sending the SAME category must not re-teach it.
    it('teaches nothing when the edit sends the unchanged category', async () => {
      mockModel.findOne.mockResolvedValue(live({ source: 'email', category: 'food' }));
      await service.update('t1', { name: 'renamed', category: 'food' });
      expect(memory.learn).not.toHaveBeenCalled();
    });

    it("teaches when confirming a waiting row's guess through the edit form", async () => {
      mockModel.findOne.mockResolvedValue(live({ source: 'email', category: 'food', categoryNeedsReview: true }));
      await service.update('t1', { category: 'food' });
      expect(memory.learn).toHaveBeenCalled();
    });

    // Pins the compensate path: if the ledger rejects, update() rethrows before
    // ever reaching the memory.learn() call at the end of the method.
    it('teaches nothing when the ledger fails and the edit is rolled back', async () => {
      mockModel.findOne.mockResolvedValue(live({ source: 'email', merchant: 'SOME STORE', category: 'food' }));
      mockModel.findOneAndUpdate.mockResolvedValue({});
      mockModel.updateOne = jest.fn().mockResolvedValue({});
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      await expect(service.update('t1', { amount: 130, category: 'other' })).rejects.toThrow('ledger down');
      expect(memory.learn).not.toHaveBeenCalled();
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

    it('rejects an invalid timestamp and a blank name', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await expect(service.update('t1', { timestamp: 'nope' })).rejects.toThrow(/timestamp/);
      await expect(service.update('t1', { name: '   ' })).rejects.toThrow(/name/);
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('an empty body writes nothing and moves nothing', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', {});
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(ledger.apply).not.toHaveBeenCalled();
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

    it('rolls a withdrawal back only while the old amount still covers its items', async () => {
      mockModel.findOne = jest.fn().mockResolvedValue({ _id: 't1', userId: 1, amount: -5000, transactionName: 'atm', isWithdrawal: true, allocatedCash: 4500 });
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      mockModel.updateOne = jest.fn().mockResolvedValue({ matchedCount: 0 });
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await expect(service.update('t1', { amount: 6000 })).rejects.toThrow('ledger down');
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: 't1', $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, 5000 + 0.005] } },
        { $set: { amount: -5000 } },
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('needs manual repair'), expect.anything());
    });

    it("refuses to shrink a withdrawal below what's itemized", async () => {
      mockModel.findOne.mockResolvedValue(live({ isWithdrawal: true, allocatedCash: 4500, amount: -5000 }));
      await expect(service.update('t1', { amount: 4000 })).rejects.toThrow('$4,500.00 of this withdrawal is itemized — remove items first');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('repairs a stuck withdrawal counter once, then lets a fair amount edit through', async () => {
      // First read: the counter (480) blocks shrinking to 400. After the repair the row reads 300.
      mockModel.findOne
        .mockResolvedValueOnce({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 480, transactionName: 'cajero' })
        .mockResolvedValueOnce({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 300, transactionName: 'cajero' });
      repair.repair.mockResolvedValue(true);
      mockModel.findOneAndUpdate.mockResolvedValue({ _id: 't1' });
      await expect(service.update('t1', { amount: 400 })).resolves.toBeUndefined();
      expect(repair.repair).toHaveBeenCalledWith('t1');
    });

    it('still refuses when the items really hold more than the new amount, naming what they hold', async () => {
      mockModel.findOne.mockResolvedValue({ _id: 't1', amount: -500, isWithdrawal: true, allocatedCash: 480, transactionName: 'cajero' });
      repair.repair.mockResolvedValue(false);
      await expect(service.update('t1', { amount: 400 })).rejects.toThrow(/\$480\.00 of this withdrawal is itemized/);
    });

    it('guards a withdrawal amount edit against items added meanwhile', async () => {
      mockModel.findOne.mockResolvedValue(live({ isWithdrawal: true, allocatedCash: 4500, amount: -5000 }));
      await service.update('t1', { amount: 4600 });
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -5000, $expr: { $lte: [{ $ifNull: ['$allocatedCash', 0] }, 4600 + 0.005] } }),
        { $set: { amount: -4600 } },
      );
    });

    it('adds no itemizing guard to an ordinary edit', async () => {
      mockModel.findOne.mockResolvedValue(live());
      await service.update('t1', { amount: 130 });
      expect(mockModel.findOneAndUpdate.mock.calls[0][0]).not.toHaveProperty('$expr');
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
        expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ _id: 't1', deletedAt: null }),
          expect.anything(),
        );
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

  // When the compensation ITSELF fails, the row is left in a state no retry
  // can repair. The ledger error — not the compensation's — is still what the
  // caller sees (it is the one worth surfacing), and the failure is logged
  // loudly, with the id, since nothing else will ever say so again.
  describe('compensation failure', () => {
    beforeEach(() => { mockModel.updateOne = jest.fn().mockResolvedValue({}); mockModel.deleteOne = jest.fn().mockResolvedValue({}); });

    it('create: logs and still rejects with the ledger error when the rollback delete also fails', async () => {
      mockModel.create.mockResolvedValue({ _id: 'new1', transactionName: 'colmado' });
      mockModel.deleteOne.mockRejectedValueOnce(new Error('db down'));
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.create({ type: 'expense', amount: 10, name: 'Colmado', category: 'food' })).rejects.toThrow('ledger down');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('new1'), expect.anything());
    });

    it('update: logs and still rejects with the ledger error when the restore also fails', async () => {
      mockModel.findOne = jest.fn().mockResolvedValue({ _id: 't1', userId: 1, amount: -100, transactionName: 'old', category: 'food', transferKind: undefined });
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      mockModel.updateOne.mockRejectedValueOnce(new Error('db down'));
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.update('t1', { amount: 130 })).rejects.toThrow('ledger down');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('t1'), expect.anything());
    });

    it('softDelete: logs and still rejects with the ledger error when the restore also fails', async () => {
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'rent' });
      mockModel.updateOne.mockRejectedValueOnce(new Error('db down'));
      ledger.reverse.mockRejectedValueOnce(new Error('ledger down'));
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.softDelete('t1')).rejects.toThrow('ledger down');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('t1'), expect.anything());
    });

    it('resolveTransfer: logs and still rejects with the ledger error when the revert also fails', async () => {
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', amount: -100, transactionName: 'transfer' });
      mockModel.updateOne.mockRejectedValueOnce(new Error('db down'));
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.resolveTransfer('t1', 'external')).rejects.toThrow('ledger down');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('t1'), expect.anything());
    });
  });

  // update's compensation must restore every field the patch touched, not
  // just amount: a co-edit of name+amount that rolls back must not leave the
  // new name stranded on the old amount.
  describe('update — full pre-image restore on ledger failure', () => {
    it('restores every patched field, not only amount', async () => {
      mockModel.findOne = jest.fn().mockResolvedValue({ _id: 't1', userId: 1, amount: -100, transactionName: 'old', category: 'food', transferKind: undefined });
      mockModel.findOneAndUpdate = jest.fn().mockResolvedValue({});
      mockModel.updateOne = jest.fn().mockResolvedValue({});
      ledger.apply.mockRejectedValueOnce(new Error('ledger down'));

      await expect(service.update('t1', { amount: 130, name: 'New' })).rejects.toThrow('ledger down');

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: 't1' },
        { $set: { amount: -100, transactionName: 'old' } },
      );
    });
  });
});
