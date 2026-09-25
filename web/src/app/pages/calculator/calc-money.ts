const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

/**
 * Money on the growth calculator. Results can be astronomically large
 * (e.g. $1 at 100% for 60 years), so above a trillion it turns compact
 * ("$1.4T"), and above $999T it just says so — never E notation.
 */
export function calcMoney(n: number, cents = true): string {
  const abs = Math.abs(n);
  if (abs >= 1e15) return n < 0 ? '−over $999T' : 'over $999T';
  if (abs >= 1e12) return COMPACT.format(n);
  return (cents ? EXACT : WHOLE).format(n);
}
