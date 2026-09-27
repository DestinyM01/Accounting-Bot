import { AsyncLocalStorage } from 'async_hooks';
import type { TransactionRunner } from '../shared/ledger/transaction-runner';

/**
 * Stands in for TransactionRunner in unit tests: no database, same contract.
 * active() is backed by an AsyncLocalStorage, exactly like the real runner,
 * so it reflects the current async context (per call), not a shared counter —
 * true only for the async chain running inside this run()'s fn. retryOnce()
 * makes the next run call fn twice (a transient-error retry) and return the
 * second result. rejectNext(err) makes the next run reject with err without
 * calling fn (an error surfacing from the transaction, e.g. a duplicate key).
 */
export class FakeTransactionRunner implements Pick<TransactionRunner, 'run' | 'active'> {
  calls = 0;
  private readonly als = new AsyncLocalStorage<boolean>();
  private retry = false;
  private rejection: { err: unknown } | null = null;

  retryOnce(): this {
    this.retry = true;
    return this;
  }

  rejectNext(err: unknown): this {
    this.rejection = { err };
    return this;
  }

  active(): boolean {
    return this.als.getStore() === true;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active()) throw new Error('TransactionRunner.run: already inside a transaction');
    this.calls++;
    if (this.rejection) {
      const { err } = this.rejection;
      this.rejection = null;
      throw err;
    }
    const attempts = this.retry ? 2 : 1;
    this.retry = false;
    return this.als.run(true, async () => {
      let result: T;
      for (let i = 0; i < attempts; i++) {
        result = await fn();
      }
      return result;
    });
  }
}
