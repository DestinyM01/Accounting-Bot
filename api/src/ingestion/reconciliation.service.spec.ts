import { matchesRule } from './reconciliation.service';

const rule = { _id: 'r1', userId: 1, amount: 1942.1, dayOfMonth: 24, active: true };

describe('matchesRule', () => {
  it('matches an exact amount within the date window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(true);
  });

  it('matches at the edges of the +/-3 day window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 21) })).toBe(true);
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 27) })).toBe(true);
  });

  it('rejects a date outside the window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 28) })).toBe(false);
  });

  // No tolerance: these are fixed payments, so a near-miss is a different
  // transaction, not the same one rounded.
  it('rejects an amount that differs at all', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.11, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });

  it('compares on absolute value, since expenses are stored negative', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(true);
  });

  it('rejects an inactive rule', () => {
    expect(matchesRule({ ...rule, active: false }, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });

  it('rejects a different user', () => {
    expect(matchesRule(rule, { userId: 2, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });
});
