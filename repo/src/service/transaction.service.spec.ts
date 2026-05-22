import { TransactionService } from './transaction.service';
import { TransactionType } from '../type/enum/transactionType.enam';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a chainable find mock: find().sort().limit().exec() */
function mockFindChain(result: any) {
  const exec = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  return { find, sort, limit, exec };
}

/** Minimal IContext mock for deleteTransactionById */
function makeCtx(userId = 42) {
  return {
    from: { id: userId },
    session: { language: 'en', lastBotMessage: 1 },
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
  });

  // ── deleteTransactionById ──────────────────────────────────────────────────

  describe('deleteTransactionById', () => {
    it('calls reverseTransaction with stored amount when deleting an expense', async () => {
      const transaction = { transactionType: TransactionType.EXPENSE, amount: -300, transactionName: 'groceries' };

      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });
      mockTransactionModel.deleteOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

      await service.deleteTransactionById(makeCtx(), 'txid1');

      // BalanceService.reverseTransaction receives storedAmount (-300) and does balance -= -300 = balance + 300
      expect(mockBalanceService.reverseTransaction).toHaveBeenCalledWith(
        42, -300, 'groceries', 'txid1',
      );
      expect(mockTransactionModel.deleteOne).toHaveBeenCalledWith({ _id: 'txid1' });
    });

    it('calls reverseTransaction with stored amount when deleting income', async () => {
      const transaction = { transactionType: TransactionType.INCOME, amount: 500, transactionName: 'salary' };

      mockTransactionModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(transaction) });
      mockTransactionModel.deleteOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

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
  });

  // ── searchTransactions ─────────────────────────────────────────────────────

  describe('searchTransactions', () => {
    it('queries by userId only when no groupIds provided', async () => {
      const mockResults = [{ transactionName: 'rent', amount: -800 }];
      const { find, sort, limit, exec } = mockFindChain(mockResults);
      mockTransactionModel.find = find;

      const results = await service.searchTransactions(1, 'rent');

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
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
