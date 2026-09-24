import { RecurringSchema } from './recurring.schema';

describe('RecurringSchema', () => {
  // The api's hourly sweep records the last month each rule has handled here.
  // Row existence cannot serve as that marker: soft-delete $unsets the
  // recurring link, so a deleted recurring row would be booked again every hour.
  it('declares lastPeriod as an optional string', () => {
    const path = RecurringSchema.path('lastPeriod');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    expect(path.isRequired).toBeFalsy();
  });
});
