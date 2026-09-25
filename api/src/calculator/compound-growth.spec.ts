import { compoundGrowth } from './compound-growth';

describe('compoundGrowth', () => {
  it('earns nothing at 0%: the balance is what was put in', () => {
    expect(compoundGrowth({ start: 500, monthly: 100, rate: 0, years: 2 })).toEqual({
      finalBalance: 2900,
      putIn: 2900,
      interest: 0,
      years: [
        { year: 1, balance: 1700, putIn: 1700, interest: 0 },
        { year: 2, balance: 2900, putIn: 2900, interest: 0 },
      ],
    });
  });

  it('compounds a starting amount monthly: $1,000 at 12% for a year', () => {
    expect(compoundGrowth({ start: 1000, monthly: 0, rate: 12, years: 1 })).toMatchObject({
      finalBalance: 1126.83,
      putIn: 1000,
      interest: 126.83,
    });
  });

  it('adds each deposit at the end of its month: $100/month at 12% for a year', () => {
    expect(compoundGrowth({ start: 0, monthly: 100, rate: 12, years: 1 })).toMatchObject({
      finalBalance: 1268.25,
      putIn: 1200,
      interest: 68.25,
    });
  });

  it("matches the closed-form annuity for the bot's example: $1,000/month for 15 years at 10%", () => {
    const i = 0.1 / 12;
    const n = 15 * 12;
    const closedForm = Math.round(1000 * ((Math.pow(1 + i, n) - 1) / i) * 100) / 100;
    const r = compoundGrowth({ start: 0, monthly: 1000, rate: 10, years: 15 });
    expect(Math.abs(r.finalBalance - closedForm)).toBeLessThanOrEqual(0.01);
    expect(r.putIn).toBe(180000);
    expect(r.years).toHaveLength(15);
  });

  it('gives one row per year with the exact amount put in so far, the last being the final figures', () => {
    const r = compoundGrowth({ start: 250, monthly: 50, rate: 5, years: 3 });
    expect(r.years.map((y) => [y.year, y.putIn])).toEqual([[1, 850], [2, 1450], [3, 2050]]);
    expect(r.finalBalance).toBe(r.years[2].balance);
    expect(r.interest).toBe(r.years[2].interest);
  });

  it('rounds only on output, never the running balance', () => {
    // 0.333 × 12 = 3.996 → $4.00; rounding each month would give 0.33 × 12 = $3.96.
    expect(compoundGrowth({ start: 0, monthly: 0.333, rate: 0, years: 1 }).finalBalance).toBe(4);
  });
});
