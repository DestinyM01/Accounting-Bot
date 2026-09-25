/** Absorbs the floating-point drift `$inc` accumulates in a sum of cents. */
export const HALF_CENT = 0.005;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 4500 → "$4,500.00", the web's money format. */
export const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
