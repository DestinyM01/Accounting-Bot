/**
 * A chainable stand-in for a Mongoose query in unit tests: every chain method
 * returns the stub, and lean() / exec() resolve to `result`.
 */
export function queryStub<T>(result: T) {
  const q: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'populate']) q[m] = jest.fn(() => q);
  q.lean = jest.fn(() => Promise.resolve(result));
  q.exec = jest.fn(() => Promise.resolve(result));
  return q as any;
}
