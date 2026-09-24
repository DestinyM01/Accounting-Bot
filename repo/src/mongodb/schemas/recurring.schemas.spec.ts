import { RecurringSchema } from './recurring.schemas';

describe('RecurringSchema (bot mirror)', () => {
  // Same collection as the api's schema; a field in one and not the other is a bug.
  it('declares lastPeriod as an optional string', () => {
    const path = RecurringSchema.path('lastPeriod');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    expect(path.isRequired).toBeFalsy();
  });
});
