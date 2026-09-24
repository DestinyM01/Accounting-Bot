import { ExportService } from './export.service';
import { SPENDING_ONLY } from '../type/transfer-kind';

/** Build a chainable find mock: find().sort().lean().exec() */
function mockFindChain(result: any) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ lean });
  const find = jest.fn().mockReturnValue({ sort });
  return { find, sort, lean, exec };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ExportService', () => {
  let service: ExportService;
  let mockTransactionModel: any;

  beforeEach(() => {
    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn();

    service = new ExportService(mockTransactionModel as any);
  });

  // Internal transfers post as transactionType EXPENSE with a negative
  // amount, so an unfiltered export prints them as ordinary expense rows —
  // summing "amount" by type in a spreadsheet over-reports spending.

  describe('exportUserTransactionsCsvByPeriod', () => {
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.exportUserTransactionsCsvByPeriod(1, new Date(2026, 0, 1), new Date(2026, 0, 31));

      const query = find.mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });

  describe('exportUserTransactionsCsv', () => {
    it('excludes deleted rows and internal/unresolved transfers', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await service.exportUserTransactionsCsv(1);

      const query = find.mock.calls[0][0];
      expect(query).toEqual(expect.objectContaining(SPENDING_ONLY));
    });
  });
});
