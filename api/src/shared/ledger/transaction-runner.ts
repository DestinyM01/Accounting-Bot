import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model, Schema, Types } from 'mongoose';

/** Thrown inside the startup check's transaction to abort it on purpose. */
class AbortCheck extends Error {}

const CHECK_TIMEOUT_MS = 15_000;

interface Check {
  at: Date;
}

/**
 * Runs a function inside a MongoDB transaction: everything it writes commits
 * together, or nothing does. Mongoose's transactionAsyncLocalStorage makes
 * every model call inside fn join the transaction on its own, so callers
 * write their queries as usual.
 *
 * Rules for fn: no try/catch around database calls (a server error ends the
 * transaction; swallowing it makes the driver retry the whole thing for up to
 * 120 s), no Promise.all, no logging or outside calls (fn can run more than
 * once), and no run() inside run(). Handle errors on the promise run() returns.
 */
@Injectable()
export class TransactionRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(TransactionRunner.name);

  constructor(@InjectConnection() private readonly connection: Connection) {
    // Idempotent, and on the very Mongoose instance this connection belongs to.
    this.connection.base.set('transactionAsyncLocalStorage', true);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active()) throw new Error('TransactionRunner.run: already inside a transaction');
    // The result is kept here rather than taken from transaction(), whose
    // resolved value differs between driver versions.
    let result: T;
    await this.connection.transaction(async () => {
      result = await fn();
    });
    return result;
  }

  /** True only inside run(): the async-local store holds the transaction's session. */
  active(): boolean {
    const store = (this.connection.base as any).transactionAsyncLocalStorage?.getStore();
    return store?.session != null;
  }

  /**
   * Proves on the real server, once per start, that transactions work: a
   * transaction writes two markers (one through create, one through an
   * update query) and is aborted on purpose; neither may exist afterwards.
   * If this fails the api does not start, so a rollout keeps the old pod.
   */
  async onApplicationBootstrap(): Promise<void> {
    let timer: NodeJS.Timeout;
    const cap = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${CHECK_TIMEOUT_MS / 1000} s`)), CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.check(), cap]);
      this.logger.log('MongoDB transactions: working (startup check)');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`MongoDB transactions: NOT working (${reason}); the api will not start`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async check(): Promise<void> {
    const model = this.checkModel();
    // Creates the collection outside any transaction (and is a no-op once it
    // exists); creating it inside would race Mongoose's own createCollection.
    await model.init();
    const created = new Types.ObjectId();
    const upserted = new Types.ObjectId();
    const at = new Date();
    let aborted = false;
    try {
      await this.run(async () => {
        await model.create({ _id: created, at });
        await model.updateOne({ _id: upserted }, { $set: { at } }, { upsert: true });
        throw new AbortCheck();
      });
    } catch (err) {
      if (!(err instanceof AbortCheck)) throw err;
      aborted = true;
    }
    if (!aborted) {
      throw new Error('the abort sentinel never surfaced: the transaction did not abort as expected');
    }
    const survivedCreate = await model.exists({ _id: created });
    const survivedUpdate = await model.exists({ _id: upserted });
    if (survivedCreate || survivedUpdate) {
      await model.deleteMany({ _id: { $in: [created, upserted] } });
      const which = [survivedCreate && 'create', survivedUpdate && 'updateOne'].filter(Boolean).join(' and ');
      throw new Error(`a write inside the transaction survived its abort (${which}): operations are not joining the transaction`);
    }
  }

  private checkModel(): Model<Check> {
    const existing = this.connection.models.TransactionCheck as Model<Check> | undefined;
    if (existing) return existing;
    const schema = new Schema<Check>({ at: Date }, { versionKey: false, collection: 'transactionchecks' });
    return this.connection.model<Check>('TransactionCheck', schema);
  }
}
