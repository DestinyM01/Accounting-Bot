import { Logger } from '@nestjs/common';
import { Mongoose } from 'mongoose';
import { TransactionRunner } from './transaction-runner';

/**
 * A fake connection: `base` is a real Mongoose instance, so the constructor's
 * `set('transactionAsyncLocalStorage', true)` creates a real AsyncLocalStorage,
 * and `transaction` runs `fn` inside it with a fake session — the same shape
 * real Mongoose code relies on, without a database.
 */
function fakeConnection() {
  const base = new Mongoose();
  const checkModel = {
    init: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
    exists: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const connection: any = {
    base,
    models: {},
    model: jest.fn(() => checkModel),
    transaction: jest.fn(async (fn: () => Promise<any>) =>
      (base as any).transactionAsyncLocalStorage.run({ session: {} }, () => fn()),
    ),
  };
  return { connection, checkModel };
}

describe('TransactionRunner', () => {
  let connection: any;
  let checkModel: any;
  let runner: TransactionRunner;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    ({ connection, checkModel } = fakeConnection());
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    runner = new TransactionRunner(connection);
  });

  afterEach(() => {
    // A failing assertion inside a fake-timer test must not leak fake timers
    // into the next test — restore real timers unconditionally here rather
    // than at the end of each test that switches them on.
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('switches on transactionAsyncLocalStorage in the constructor', () => {
    expect(connection.base.transactionAsyncLocalStorage).toBeDefined();
  });

  describe('run', () => {
    it("returns fn's result and calls connection.transaction once", async () => {
      const result = await runner.run(async () => 'ok');
      expect(result).toBe('ok');
      expect(connection.transaction).toHaveBeenCalledTimes(1);
    });

    it('is active only while fn runs', async () => {
      expect(runner.active()).toBe(false);
      let insideFn = false;
      await runner.run(async () => {
        insideFn = runner.active();
      });
      expect(insideFn).toBe(true);
      expect(runner.active()).toBe(false);
    });

    it("propagates fn's error unchanged", async () => {
      const err = new Error('boom');
      await expect(
        runner.run(async () => {
          throw err;
        }),
      ).rejects.toBe(err);
    });

    it('refuses to nest', async () => {
      await expect(runner.run(async () => runner.run(async () => undefined))).rejects.toThrow(
        /already inside a transaction/,
      );
    });
  });

  describe('the startup check', () => {
    it('passes when both markers are gone after the abort', async () => {
      await expect(runner.onApplicationBootstrap()).resolves.toBeUndefined();
      const initOrder = checkModel.init.mock.invocationCallOrder[0];
      const createOrder = checkModel.create.mock.invocationCallOrder[0];
      expect(initOrder).toBeLessThan(createOrder);
      expect(checkModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything(), at: expect.any(Date) }),
      );
      expect(checkModel.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $set: { at: expect.any(Date) } },
        { upsert: true },
      );
      expect(checkModel.exists).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith('MongoDB transactions: working (startup check)');
    });

    it('fails when the transaction is refused', async () => {
      connection.transaction.mockRejectedValueOnce(
        new Error('Transaction numbers are only allowed on a replica set member or mongos'),
      );
      await expect(runner.onApplicationBootstrap()).rejects.toThrow(
        /Transaction numbers are only allowed/,
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('NOT working (Transaction numbers are only allowed'),
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('the api will not start'));
    });

    it('fails when a marker survives the abort', async () => {
      checkModel.exists.mockResolvedValueOnce({ _id: 'x' });
      await expect(runner.onApplicationBootstrap()).rejects.toThrow(/survived its abort \(create\)/);
      expect(checkModel.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [expect.anything(), expect.anything()] },
      });
    });

    it('fails when only the updateOne marker survives the abort', async () => {
      checkModel.exists.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'y' });
      await expect(runner.onApplicationBootstrap()).rejects.toThrow(/survived its abort \(updateOne\)/);
      expect(checkModel.deleteMany).toHaveBeenCalledWith({
        _id: { $in: [expect.anything(), expect.anything()] },
      });
    });

    it('fails when the transaction commits without the abort sentinel ever surfacing', async () => {
      // connection.transaction resolves without ever invoking the fn it was
      // given: run() then resolves normally, the catch in check() never runs,
      // and aborted stays false — the transaction did not actually abort.
      connection.transaction.mockImplementationOnce(async () => undefined);
      await expect(runner.onApplicationBootstrap()).rejects.toThrow(/sentinel never surfaced/);
    });

    it('awaits init() before starting the transaction', async () => {
      let resolveInit!: () => void;
      checkModel.init.mockReturnValue(new Promise<void>((resolve) => { resolveInit = resolve; }));
      const bootstrap = runner.onApplicationBootstrap();
      // Flush pending microtasks without letting init() resolve.
      await new Promise((r) => setImmediate(r));
      expect(connection.transaction).not.toHaveBeenCalled();
      expect(checkModel.create).not.toHaveBeenCalled();
      resolveInit();
      await expect(bootstrap).resolves.toBeUndefined();
    });

    it('fails at the 15 s cap', async () => {
      jest.useFakeTimers();
      checkModel.init.mockReturnValue(new Promise(() => undefined));
      const bootstrap = runner.onApplicationBootstrap();
      jest.advanceTimersByTime(15_000);
      await expect(bootstrap).rejects.toThrow(/no answer within 15 s/);
    });

    it('clears the cap timer once the check passes', async () => {
      jest.useFakeTimers();
      await runner.onApplicationBootstrap();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('reuses an existing model', async () => {
      connection.models.TransactionCheck = checkModel;
      await runner.onApplicationBootstrap();
      expect(connection.model).not.toHaveBeenCalled();
    });
  });
});
