import { model } from 'mongoose';
import { RecurringSchema } from './recurring.schema';
import { TransactionType } from './transaction-type.enum';

const RecurringDayCheck = model('RecurringDayCheck', RecurringSchema);
const ruleOn = (dayOfMonth: unknown) =>
  new RecurringDayCheck({ userId: 1, userName: 'web', transactionName: 'rent', transactionType: TransactionType.EXPENSE, amount: 100, dayOfMonth });

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

  // planOccurrences assumes the day exists in every month; 29–31 would spill into the next one.
  it.each([1, 28])('accepts day %i', (day) => {
    expect(ruleOn(day).validateSync()).toBeUndefined();
  });

  it.each([0, 29, 1.5])('rejects day %p', (day) => {
    expect(ruleOn(day).validateSync()?.errors.dayOfMonth).toBeDefined();
  });
});
