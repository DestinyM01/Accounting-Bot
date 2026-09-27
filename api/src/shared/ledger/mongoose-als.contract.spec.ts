import { Mongoose, Schema } from 'mongoose';

/**
 * Pins the Mongoose behaviour TransactionRunner relies on: with
 * transactionAsyncLocalStorage on, a query built inside the async-local store
 * carries the transaction's session. No database: queries are only built,
 * never run. If a Mongoose upgrade breaks this, CI fails here, not production.
 */
describe('Mongoose transactionAsyncLocalStorage contract', () => {
  const mongoose = new Mongoose();
  mongoose.set('transactionAsyncLocalStorage', true);
  const Thing = mongoose.model('Thing', new Schema({ n: Number }));
  const session = { id: 'fake-session' } as any;
  const store = () => (mongoose as any).transactionAsyncLocalStorage;

  const queries = {
    findOne: () => Thing.findOne({ n: 1 }),
    findOneAndUpdate: () => Thing.findOneAndUpdate({ n: 1 }, { $set: { n: 2 } }),
    updateOne: () => Thing.updateOne({ n: 1 }, { $set: { n: 2 } }),
    deleteOne: () => Thing.deleteOne({ n: 1 }),
    countDocuments: () => Thing.countDocuments({ n: 1 }),
  };

  it('has an async-local store once the option is set', () => {
    expect(store()).toBeDefined();
  });

  for (const [name, build] of Object.entries(queries)) {
    it(`${name} picks up the session inside the store`, () => {
      const opts = store().run({ session }, () => (build() as any)._optionsForExec());
      expect(opts.session).toBe(session);
    });

    it(`${name} has no session outside the store`, () => {
      expect((build() as any)._optionsForExec().session).toBeUndefined();
    });
  }

  // Pins the save path (Model.create/doc.save), not just query builders: it
  // goes through Model.collection.insertOne rather than a Query, so it's
  // worth confirming separately that the session still threads through. The
  // insertOne spy replaces the driver call outright, so this never touches a
  // real connection or Mongoose's connect-time buffering.
  describe('the save path (Model.create)', () => {
    it('threads the session through Model.create via collection.insertOne', async () => {
      const insertOne = jest
        .spyOn(Thing.collection, 'insertOne')
        .mockResolvedValue({ acknowledged: true, insertedId: 'x' } as any);

      await store().run({ session }, () => Thing.create({ n: 1 }));

      expect(insertOne).toHaveBeenCalledTimes(1);
      const opts = insertOne.mock.calls[0][1] as any;
      expect(opts?.session).toBe(session);

      insertOne.mockRestore();
    });
  });
});
