import { TransactionService } from './transaction.service';
import { TransactionType } from '../type/enum/transactionType.enam';
import { NOT_DELETED } from '../type/transfer-kind';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a chainable find mock: find().sort().limit().exec() */
function mockFindChain(result: any) {
  const exec = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  return { find, sort, limit, exec };
}

/** Minimal IContext mock for deleteTransactionById and the list pickers */
function makeCtx(userId = 42) {
  return {
    from: { id: userId },
    session: { language: 'en', lastBotMessage: 1 },
    editMessageText: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TransactionService', () => {
  let service: TransactionService;
  let mockTransactionModel: any;
  let mockBot: any;
  let mockBalanceService: any;

  beforeEach(() => {
    mockBot = {
      telegram: { editMessageText: jest.fn().mockResolvedValue(undefined) },
    };

    mockBalanceService = {
      getOrCreateBalance: jest.fn(),
      updateBalance: jest.fn(),
      reverseTransaction: jest.fn().mockResolvedValue(undefined),
    };

    // Jest fn used as a constructor (new this.transactionModel(...))
    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn();
    mockTransactionModel.findOne = jest.fn();
    mockTransactionModel.findByIdAndUpdate = jest.fn();
    mockTransactionModel.findOneAndUpdate = jest.fn();
    mockTransactionModel.deleteOne = jest.fn();
    mockTransactionModel.deleteMany = jest.fn();

    service = new TransactionService(
      mockTransactionModel as any,
      mockBot as any,
      mockBalanceService,
    );
  });

  // ── createTransaction ──────────────────────────────────────────────────────

  describe('createTransaction', () => {
    it('stores income amount as-is (positive)', async () => {
      const savedDoc = { _id: 'inc1', amount: 100 };
      const mockSave = jest.fn().mockResolvedValue(savedDoc);
      mockTransactionModel.mockImplementation(() => ({ save: mockSave }));

      const result = await service.createTransaction({
        userId: 1,
        userName: 'Alice',
        transactionName: 'salary',
        transactionType: TransactionType.INCOME,
        amount: 100,
      });

      expect(mockTransactionModel).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100 }),
      );
      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(savedDoc);
    });

    it('negates expense amount before saving', async () => {
      const savedDoc = { _id: 'exp1', amount: -250 };
      const mockSave = jest.fn().mockResolvedValue(savedDoc);
      mockTransactionModel.mockImplementation(() => ({ save: mockSave }));

      await service.createTransaction({
        userId: 1,
        userName: 'Alice',
        transactionName: 'groceries',
        transactionType: TransactionType.EXPENSE,
        amount: 250,
      });

      expect(mockTransactionModel).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -250 }),
      );
    });

    it('propagates errors from save', async () => {
      const mockSave = jest.fn().mockRejectedValue(new Error('DB error'));
      mockTransactionModel.mockImplementation(() => ({ save: mockSave }));

      await expect(
        service.createTransaction({
          userId: 1,
          userName: 'Bob',
          transactionName: 'rent',
          transactionType: TransactionType.EXPENSE,
          amount: 800,
        }),
      ).rejects.toThrow('DB error');
    });

    // Without this, the cron-created transaction never carries the rule id, so
    // the ingestion reconciliation query can never find it and the same
    // payment gets recorded twice when the bank email arrives.
    it('persists recurringId when provided', async () => {
      const savedDoc = { _id: 'exp2', amount: -800, recurringId: 'rule-1' };
      const mockSave = jest.fn().mockResolvedValue(savedDoc);
      mockTransactionModel.mockImplementation(() => ({ save: mockSave }));

      await service.createTransaction({
        userId: 1,
        userName: 'Bob',
        transactionName: 'rent',
        transactionType: TransactionType.EXPENSE,
        amount: 800,
        recurringId: 'rule-1',
      });

      expect(mockTransactionModel).toHaveBeenCalledWith(
        expect.objectContaining({ recurringId: 'rule-1' }),
      );
    });

    // Guards against stamping every manual transaction with a recurringId
    // it was never given.
    it('leaves recurringId undefined when not provided', async () => {
      const savedDoc = { _id: 'exp3', amount: -800 };
      const mockSave = jest.fn().mockResolvedValue(savedDoc);
      mockTransactionModel.mockImplementation(() => ({ save: mockSave }));

      await service.createTransaction({
        userId: 1,
        userName: 'Bob',
        transactionName: 'rent',
        transactionType: TransactionType.EXPENSE,
        amount: 800,
      });

      // Direct property access rather than objectContaining({ recurringId:
      // undefined }): in Jest 29, objectContaining requires the key to be
      // present on the received object to match an undefined expectation.
      const created = mockTransactionModel.mock.calls[0][0];
      expect(created.recurringId).toBeUndefined();
    });
  });

  // ── deleteTransactionById ──────────────────────────────────────────────────

  describe('deleteTransactionById', () => {
    it('calls reverseTransaction with stored amount when deleting an expense', async () => {
      const transaction = { transactionType: TransactionType.EXPENSE, amount: -300, transactionName: 'groceries' };

      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });
      mockTransactionModel.findOneAndUpdate = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });

      await service.deleteTransactionById(makeCtx(), 'txid1');

      // BalanceService.reverseTransaction receives storedAmount (-300) and does balance -= -300 = balance + 300
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(
        42, -300, 'groceries', 'txid1',
      );
    });

    it('calls reverseTransaction with stored amount when deleting income', async () => {
      const transaction = { transactionType: TransactionType.INCOME, amount: 500, transactionName: 'salary' };

      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });
      mockTransactionModel.findOneAndUpdate = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });

      await service.deleteTransactionById(makeCtx(), 'txid2');

      // BalanceService.reverseTransaction receives +500 and does balance -= 500
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(
        42, 500, 'salary', 'txid2',
      );
    });

    it('does not call reverseTransaction or deleteOne when transaction is not found', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.deleteTransactionById(makeCtx(), 'missing');

      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
      expect(mockTransactionModel.deleteOne).not.toHaveBeenCalled();
    });

    // A row already soft-deleted from the web must read as "not found" here,
    // or its balance effect would be reversed a second time.
    it('looks the row up among live rows only', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.deleteTransactionById(makeCtx(), 'txid1');

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid1', userId: 42, ...NOT_DELETED }),
      );
    });
  });

  describe('deleteTransactionById — soft delete', () => {
    const chain = (v: any) => ({ exec: jest.fn().mockResolvedValue(v) });
    const live = { _id: 'txid1', transactionType: TransactionType.EXPENSE, amount: -300, transactionName: 'groceries', transferKind: undefined };

    it('soft-deletes atomically, matching only a live row, and reverses the balance', async () => {
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(live));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(live));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid1', userId: 42, deletedAt: null }),
        { $set: { deletedAt: expect.any(Date) }, $unset: { recurringId: 1, recurringPeriod: 1 } },
      );
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(42, -300, 'groceries', 'txid1');
      expect(mockTransactionModel.deleteOne).not.toHaveBeenCalled();   // never a hard delete
    });

    // internal / unresolved rows never moved the balance; deleting them must not either.
    it.each(['internal', 'unresolved'])('does not reverse the balance for a %s row', async (kind) => {
      const row = { ...live, transferKind: kind };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(row));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
    });

    // The atomic update returns null when a concurrent delete already claimed
    // the row: nothing to reverse, and no second reversal.
    it('reverses nothing when a concurrent delete already claimed the row', async () => {
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(live));
      mockTransactionModel.findOneAndUpdate = jest.fn().mockReturnValue(chain(null));
      await service.deleteTransactionById(makeCtx(), 'txid1');
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
    });
  });

  describe('updateTransactionAmount — balance guard', () => {
    const chain = (v: any) => ({ exec: jest.fn().mockResolvedValue(v) });

    it('does not move the balance for an unresolved row but still persists the new amount', async () => {
      const row = { _id: 'txid2', transactionType: TransactionType.EXPENSE, amount: -100, transactionName: 'transfer', transferKind: 'unresolved' };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findByIdAndUpdate = jest.fn().mockReturnValue(chain(undefined));
      await service.updateTransactionAmount(42, 'txid2', 150);
      expect(mockTransactionModel.findByIdAndUpdate).toHaveBeenCalledWith('txid2', { amount: -150 });
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
      expect(mockBalanceService.updateBalance).not.toHaveBeenCalled();
    });

    it('still moves the balance for an ordinary row', async () => {
      const row = { _id: 'txid3', transactionType: TransactionType.EXPENSE, amount: -100, transactionName: 'colmado', transferKind: undefined };
      mockTransactionModel.findOne = jest.fn().mockReturnValue(chain(row));
      mockTransactionModel.findByIdAndUpdate = jest.fn().mockReturnValue(chain(undefined));
      await service.updateTransactionAmount(42, 'txid3', 150);
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(42, -100, 'colmado', 'txid3');
      expect(mockBalanceService.updateBalance).toHaveBeenCalledWith(42, 150, TransactionType.EXPENSE, 'colmado', 'txid3');
    });
  });

  // ── list pickers ───────────────────────────────────────────────────────────

  describe('showLastNTransactionsWithDeleteOption', () => {
    it('lists live rows only', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.showLastNTransactionsWithDeleteOption(makeCtx(), 5);

      expect(find).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, ...NOT_DELETED }));
    });
  });

  describe('showLastNTransactionsWithEditOption', () => {
    it('lists live rows only', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.showLastNTransactionsWithEditOption(makeCtx(), 5);

      expect(find).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, ...NOT_DELETED }));
    });
  });

  // ── searchTransactions ─────────────────────────────────────────────────────

  describe('searchTransactions', () => {
    it('queries by userId only when no groupIds provided', async () => {
      const mockResults = [{ transactionName: 'rent', amount: -800 }];
      const { find, sort, limit, exec } = mockFindChain(mockResults);
      mockTransactionModel.find = find;

      const results = await service.searchTransactions(1, 'rent');

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, ...NOT_DELETED }),
      );
      expect(sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(limit).toHaveBeenCalledWith(30);
      expect(results).toEqual(mockResults);
    });

    it('includes groupIds in $in query when provided', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.searchTransactions(1, 'food', [2, 3]);

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ userId: { $in: [2, 3, 1] } }),
      );
    });

    it('uses a RegExp for transactionName matching', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.searchTransactions(1, 'Coffee');

      const query = find.mock.calls[0][0];
      expect(query.transactionName).toBeInstanceOf(RegExp);
      // Case-insensitive
      expect('COFFEE').toMatch(query.transactionName);
      expect('coffee').toMatch(query.transactionName);
    });

    it('escapes special regex characters in keyword', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      // Should not throw — special chars are escaped
      await expect(
        service.searchTransactions(1, 'price(1+2)'),
      ).resolves.not.toThrow();

      const query = find.mock.calls[0][0];
      expect(query.transactionName).toBeInstanceOf(RegExp);
    });
  });

  // ── point lookups on the edit path ─────────────────────────────────────────

  describe('getTransactionById', () => {
    it('reads live rows only', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.getTransactionById(1, 'txid9');

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid9', userId: 1, ...NOT_DELETED }),
      );
    });
  });

  describe('findOneByRecurringPeriod', () => {
    it('reads live rows only', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.findOneByRecurringPeriod(1, 'rule-1', '2026-09');

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, recurringId: 'rule-1', recurringPeriod: '2026-09', ...NOT_DELETED }),
      );
    });
  });

  describe('updateTransactionName', () => {
    it('renames live rows only', async () => {
      mockTransactionModel.findOneAndUpdate = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.updateTransactionName(1, 'txid9', 'Coffee ');

      expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid9', userId: 1, ...NOT_DELETED }),
        { transactionName: 'coffee' },
      );
    });
  });

  describe('updateTransactionAmount', () => {
    it('reads live rows only and does nothing when the row is gone', async () => {
      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await service.updateTransactionAmount(1, 'txid9', 50);

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'txid9', userId: 1, ...NOT_DELETED }),
      );
      expect(mockBalanceService.reverseTransaction).not.toHaveBeenCalled();
      expect(mockTransactionModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  // ── setCategoryById ────────────────────────────────────────────────────────

  describe('setCategoryById', () => {
    it('calls findByIdAndUpdate with id and category', async () => {
      const exec = jest.fn().mockResolvedValue(undefined);
      mockTransactionModel.findByIdAndUpdate = jest.fn().mockReturnValue({ exec });

      await service.setCategoryById('txid42', 'food');

      expect(mockTransactionModel.findByIdAndUpdate).toHaveBeenCalledWith('txid42', {
        category: 'food',
      });
      expect(exec).toHaveBeenCalled();
    });
  });
});
