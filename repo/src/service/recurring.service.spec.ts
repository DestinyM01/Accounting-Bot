import { RecurringService } from './recurring.service';

describe('RecurringService (bot)', () => {
  // Recurring bookings moved to the api's hourly sweep on 2026-09-24
  // (api/src/recurring/recurring-scheduler.service.ts). The bot is scaled to
  // zero; if it is ever started by mistake it must not book anything.
  it('no longer books recurring transactions', () => {
    expect((RecurringService.prototype as any).processRecurring).toBeUndefined();
  });
});
