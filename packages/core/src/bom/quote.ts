import type { BomLine } from './bom.js';
import { applyBps } from './money.js';

/** Rates are integer basis points: 825 is 8.25 percent. */
export type QuoteSettings = {
  markupBps: number;
  discountBps: number;
  taxBps: number;
  currency: 'USD';
};

export type QuoteTotals = {
  /** The sum of the line totals. */
  subtotalCents: number;
  /** On the subtotal. */
  markupCents: number;
  /** On the subtotal plus the markup. */
  discountCents: number;
  /** The subtotal plus the markup, minus the discount. */
  taxableCents: number;
  taxCents: number;
  totalCents: number;
};

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  markupBps: 0,
  discountBps: 0,
  taxBps: 0,
  currency: 'USD',
};

/** The most a rate can be: 100 percent for the discount, 1000 percent for the others. */
export const MAX_DISCOUNT_BPS = 10000;
export const MAX_RATE_BPS = 100000;

/** What is wrong with the settings, or null. A quote is only computed from valid ones. */
export function quoteSettingsProblem(settings: QuoteSettings): string | null {
  const rates: [string, number, number][] = [
    ['Markup', settings.markupBps, MAX_RATE_BPS],
    ['Discount', settings.discountBps, MAX_DISCOUNT_BPS],
    ['Tax', settings.taxBps, MAX_RATE_BPS],
  ];
  for (const [name, bps, max] of rates) {
    if (!Number.isInteger(bps) || bps < 0 || bps > max) {
      return `${name} must be between 0 and ${max / 100} percent, in steps of 0.01.`;
    }
  }
  return null;
}

/**
 * The totals of a quote: the subtotal, plus the markup, minus the discount on that sum,
 * then tax on what is left. Each step rounds half up to a cent, once. The API has a port
 * of this function, and both are tested against `test-vectors/quote.json`.
 */
export function computeQuote(
  lines: readonly Pick<BomLine, 'lineTotalCents'>[],
  settings: QuoteSettings,
): QuoteTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const markupCents = applyBps(subtotalCents, settings.markupBps);
  const discountCents = applyBps(subtotalCents + markupCents, settings.discountBps);
  const taxableCents = subtotalCents + markupCents - discountCents;
  const taxCents = applyBps(taxableCents, settings.taxBps);
  return {
    subtotalCents,
    markupCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}
