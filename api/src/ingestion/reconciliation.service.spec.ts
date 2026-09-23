import { matchesRule, matchedPeriod } from './reconciliation.service';
import { TransactionType } from '../shared/schemas/transaction-type.enum';

const rule = {
  _id: 'r1',
  userId: 1,
  amount: 1942.1,
  dayOfMonth: 24,
  active: true,
  transactionType: TransactionType.EXPENSE,
};

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

  // An internal transfer moves no money and an unresolved one has not been
  // asserted, so neither can be the real-world payment a rule predicts.
  // Without this guard, an internal funding leg of the same amount consumes
  // the rule and the genuine expense is never recorded at all.
  it('rejects an internal transfer of the same amount', () => {
    expect(
      matchesRule(rule, {
        userId: 1,
        amount: -1942.1,
        timestamp: new Date(2026, 7, 24),
        transferKind: 'internal',
      }),
    ).toBe(false);
  });

  it('rejects an unresolved transfer of the same amount', () => {
    expect(
      matchesRule(rule, {
        userId: 1,
        amount: -1942.1,
        timestamp: new Date(2026, 7, 24),
        transferKind: 'unresolved',
      }),
    ).toBe(false);
  });

  // Expenses are stored negative, income positive. A rule predicting an
  // expense must not be satisfied by income of the same magnitude.
  it('rejects income when the rule predicts an expense', () => {
    expect(
      matchesRule(rule, { userId: 1, amount: 1942.1, timestamp: new Date(2026, 7, 24) }),
    ).toBe(false);
  });

  it('rejects an expense when the rule predicts income', () => {
    const incomeRule = { ...rule, transactionType: TransactionType.INCOME };
    expect(
      matchesRule(incomeRule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) }),
    ).toBe(false);
  });

  // Regression guard: card transactions carry no transferKind at all and must
  // keep matching.
  it('still matches an ordinary expense with no transferKind', () => {
    expect(
      matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) }),
    ).toBe(true);
  });
});

describe('matchedPeriod', () => {
  const rentRule = {
    _id: 'rent-1',
    userId: 1,
    amount: 1942.1,
    dayOfMonth: 1,
    active: true,
    transactionType: TransactionType.EXPENSE,
  };

  // Must fail before the fix: pure day-number subtraction gives
  // |31 - 1| = 30, far outside the +/-3 day window, even though the payment
  // is really only one day away from the 1st of the following month.
  it('matches a payment on the 31st against a rule for the 1st of the next month', () => {
    expect(
      matchedPeriod(rentRule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 31) }),
    ).toBe('2026-09');
  });

  it('matches a payment on the 2nd against a rule for the 1st', () => {
    expect(
      matchedPeriod(rentRule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 8, 2) }),
    ).toBe('2026-09');
  });

  // With MATCH_WINDOW_DAYS fixed at 3, no two of the three candidate months
  // (previous/current/next) can ever both fall within the window of the same
  // payment — real calendar months are always at least 28 days apart, far
  // more than the 6-day span two 3-day windows could jointly cover. So this
  // exercises the same "nearest occurrence wins" contract from the other
  // side of a boundary: a payment that trails the previous month's occurrence
  // most closely, rather than leading the next one.
  it('returns the nearest period when two are in range', () => {
    // Rule for the 28th; February (28 days) needs no clamping, so its
    // occurrence lands exactly on Feb 28. A payment on Mar 1 is 1 day past
    // that occurrence, and 27+ days from both March's and January's — the
    // previous month's occurrence is unambiguously nearest.
    const rule = { ...rentRule, dayOfMonth: 28 };
    expect(
      matchedPeriod(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 2, 1) }),
    ).toBe('2026-02');
  });

  it('clamps a rule day beyond the month length', () => {
    const rule = { ...rentRule, dayOfMonth: 31 };
    // 2026 is not a leap year, so February has 28 days: dayOfMonth 31 clamps
    // to Feb 28, and a payment that day matches exactly.
    expect(
      matchedPeriod(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 1, 28) }),
    ).toBe('2026-02');
  });

  it('still returns null for an amount mismatch', () => {
    expect(
      matchedPeriod(rentRule, { userId: 1, amount: -1942.11, timestamp: new Date(2026, 7, 31) }),
    ).toBeNull();
  });

  it('still returns null for an internal transfer', () => {
    expect(
      matchedPeriod(rentRule, {
        userId: 1,
        amount: -1942.1,
        timestamp: new Date(2026, 7, 31),
        transferKind: 'internal',
      }),
    ).toBeNull();
  });
});
