import { matchesRule } from './reconciliation.service';
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
