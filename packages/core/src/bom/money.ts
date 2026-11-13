// Money is integer cents and rates are integer basis points (1 percent = 100). Nothing
// here uses a fraction of a cent except to round it away, once, half up.

/** One whole, in basis points. */
export const BPS = 10000;

/**
 * `numerator / denominator` rounded half up, for two non-negative integers. Integer
 * arithmetic only, so 0.5 is exactly a half and never a float just under it.
 */
export function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** `cents` times a rate in basis points, rounded half up to a cent. */
export const applyBps = (cents: number, bps: number): number => divideHalfUp(cents * bps, BPS);

/** `123450` becomes `$1,234.50`. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
