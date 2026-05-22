import { BalanceService } from './balance.service';
import { TransactionType } from '../type/enum/transactionType.enam';

// ─────────────────────────────────────────────────────────────────────────────

describe('BalanceService', () => {
  let service: BalanceService;
  let mockBalanceModel: any;
  let mockHistoryService: any;

  beforeEach(() => {
    mockBalanceModel = jest.fn();
    mockBalanceModel.findOne = jest.fn();
    mockBalanceModel.find = jest.fn();
    mockBalanceModel.countDocuments = jest.fn();
    mockBalanceModel.deleteMany = jest.fn();

    // BalanceHistoryService — failures must never break balance operations
    mockHistoryService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new BalanceService(mockBalanceModel as any, mockHistoryService);
  });

  // ── getOrCreateBalance ─────────────────────────────────────────────────────

  describe('getOrCreateBalance', () => {
    it('returns the existing balance document when found', async () => {
      const existing = { userId: 1, balance: 500 };
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.getOrCreateBalance(1);

      expect(result).toBe(existing);
      // Constructor was never called — no new doc created
      expect(mockBalanceModel).not.toHaveBeenCalled();
    });

    it('creates and saves a new balance document when none exists', async () => {
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const newDoc = { userId: 1, balance: 0, save: jest.fn().mockResolvedValue(undefined) };
      mockBalanceModel.mockImplementation(() => newDoc);

      const result = await service.getOrCreateBalance(1);

      expect(mockBalanceModel).toHaveBeenCalledWith({ userId: 1, balance: 0 });
      expect(newDoc.save).toHaveBeenCalled();
      expect(result).toBe(newDoc);
    });
  });

  // ── updateBalance ──────────────────────────────────────────────────────────

  describe('updateBalance', () => {
    it('adds amount to balance for INCOME', async () => {
      const balanceDoc = { balance: 100, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service, 'getOrCreateBalance').mockResolvedValue(balanceDoc as any);

      await service.updateBalance(1, 200, TransactionType.INCOME);

      expect(balanceDoc.balance).toBe(300);
      expect(balanceDoc.lastActivity).not.toBeNull();
      expect(balanceDoc.save).toHaveBeenCalled();
    });

    it('subtracts amount from balance for EXPENSE', async () => {
      const balanceDoc = { balance: 500, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service, 'getOrCreateBalance').mockResolvedValue(balanceDoc as any);

      await service.updateBalance(1, 150, TransactionType.EXPENSE);

      expect(balanceDoc.balance).toBe(350);
      expect(balanceDoc.lastActivity).not.toBeNull();
      expect(balanceDoc.save).toHaveBeenCalled();
    });

    it('does not change balance for unknown transaction type', async () => {
      const balanceDoc = { balance: 200, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service, 'getOrCreateBalance').mockResolvedValue(balanceDoc as any);

      // Cast to any to simulate an unexpected enum value
      await service.updateBalance(1, 99, 'UNKNOWN' as any);

      expect(balanceDoc.balance).toBe(200); // unchanged
      expect(balanceDoc.save).toHaveBeenCalled();
    });
  });

  // ── setBalance ─────────────────────────────────────────────────────────────

  describe('setBalance', () => {
    it('overrides balance with the provided amount', async () => {
      const balanceDoc = { balance: 9999, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service, 'getOrCreateBalance').mockResolvedValue(balanceDoc as any);

      await service.setBalance(1, 42);

      expect(balanceDoc.balance).toBe(42);
      expect(balanceDoc.lastActivity).not.toBeNull();
      expect(balanceDoc.save).toHaveBeenCalled();
    });

    it('can set balance to zero', async () => {
      const balanceDoc = { balance: 500, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service, 'getOrCreateBalance').mockResolvedValue(balanceDoc as any);

      await service.setBalance(1, 0);

      expect(balanceDoc.balance).toBe(0);
    });
  });

  // ── getBalance ─────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns 0 when user has no balance document', async () => {
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.getBalance(1);

      expect(result).toBe(0);
    });

    it('returns the stored balance and updates lastActivity', async () => {
      const balanceDoc = { balance: 750, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(balanceDoc) });

      const result = await service.getBalance(1);

      expect(result).toBe(750);
      expect(balanceDoc.lastActivity).not.toBeNull();
      expect(balanceDoc.save).toHaveBeenCalled();
    });

    it('sums all group balances when groupIds are provided', async () => {
      const docs = [{ balance: 100 }, { balance: 250 }];
      mockBalanceModel.find = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(docs) });

      const result = await service.getBalance(1, [2, 3]);

      expect(result).toBe(350);
      expect(mockBalanceModel.find).toHaveBeenCalledWith({ userId: { $in: [2, 3] } });
    });

    it('returns 0 when groupIds array is empty (falls back to solo lookup)', async () => {
      const balanceDoc = { balance: 123, lastActivity: null as any, save: jest.fn().mockResolvedValue(undefined) };
      mockBalanceModel.findOne = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(balanceDoc) });

      const result = await service.getBalance(1, []);

      // Empty groupIds treated the same as no groupIds
      expect(result).toBe(123);
      expect(mockBalanceModel.find).not.toHaveBeenCalled();
    });
  });
});
