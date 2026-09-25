export interface GrowthInput {
  start: number;
  monthly: number;
  /** Percent per year. */
  rate: number;
  years: number;
}

export interface GrowthYear {
  year: number;
  balance: number;
  putIn: number;
  interest: number;
}

export interface GrowthResult {
  finalBalance: number;
  putIn: number;
  interest: number;
  years: GrowthYear[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Savings growth with compound interest, month by month. The balance earns
 * rate/12 each month, and each monthly deposit is added at the end of its
 * month (an ordinary annuity), so it starts earning the month after. Rounding
 * happens only on output; the running balance keeps full precision.
 */
export function compoundGrowth({ start, monthly, rate, years }: GrowthInput): GrowthResult {
  const monthlyRate = rate / 100 / 12;
  let balance = start;
  const rows: GrowthYear[] = [];
  for (let year = 1; year <= years; year++) {
    for (let m = 0; m < 12; m++) balance = balance * (1 + monthlyRate) + monthly;
    const putIn = start + monthly * 12 * year;
    rows.push({ year, balance: round2(balance), putIn: round2(putIn), interest: round2(balance - putIn) });
  }
  const last = rows[rows.length - 1];
  return { finalBalance: last.balance, putIn: last.putIn, interest: last.interest, years: rows };
}
