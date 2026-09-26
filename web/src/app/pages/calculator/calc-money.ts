const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

/**
 * Money on the growth calculator. Results can be astronomically large
 * (e.g. $1 at 100% for 60 years), so above a trillion it turns compact
 * ("$1.4T"), and anything that would round to $1000T or more just says
 * "over $999T" — never E notation.
 */
export function calcMoney(n: number, cents = true): string {
  const abs = Math.abs(n);
  // COMPACT rounds to 1 decimal place of T; 999.95e12 is where that rounds up to 1000.0T.
  if (abs >= 999.95e12) return n < 0 ? '−over $999T' : 'over $999T';
  if (abs >= 1e12) return COMPACT.format(n);
  return (cents ? EXACT : WHOLE).format(n);
}
