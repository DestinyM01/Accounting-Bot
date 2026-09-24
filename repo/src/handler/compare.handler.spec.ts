import { CompareHandler } from './compare.handler';
import { SPENDING_ONLY } from '../type/transfer-kind';

/** Build a chainable find mock: find().sort().limit().lean().exec() */
function mockFindChain(result: any) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const limit = jest.fn().mockReturnValue({ lean });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  return { find, sort, limit, lean, exec };
}

/** Minimal IContext mock with two periods already collected. */
function makeCtx(userId = 1) {
  return {
    from: { id: userId },
    session: { language: 'en', compare: ['period one\n', 'period two\n'] },
    editMessageText: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CompareHandler', () => {
  let handler: CompareHandler;
  let mockOpenAi: any;
  let mockTransactionModel: any;
  let mockBalanceModel: any;

  beforeEach(() => {
    mockOpenAi = { generateResponse: jest.fn().mockResolvedValue('advice') };

    mockTransactionModel = jest.fn();
    mockTransactionModel.find = jest.fn();

    mockBalanceModel = jest.fn();
    mockBalanceModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ balance: 0 }) }),
    });

    handler = new CompareHandler(mockOpenAi, mockTransactionModel as any, mockBalanceModel as any);
  });

  // The last-30 rows go into the advisor prompt as raw amounts. An internal
  // transfer or a deleted row there would have the model reason about
  // spending that never happened.
  describe('get_compare', () => {
    it('feeds the prompt only live, spending rows', async () => {
      const { find } = mockFindChain([]);
      mockTransactionModel.find = find;

      await handler.get_compare(makeCtx());

      expect(find).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, ...SPENDING_ONLY }));
    });
  });
});
