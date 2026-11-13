import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import vectors from '../../test-vectors/quote.json' with { type: 'json' };
import { type BomUnit, entryUnitPriceCents, lineTotalCents } from './bom.js';
import { getEntry, SEED_CATALOG } from '../catalog/index.js';
import { applyBps, divideHalfUp, formatMoney } from './money.js';
import {
  computeQuote,
  DEFAULT_QUOTE_SETTINGS,
  type QuoteSettings,
  quoteSettingsProblem,
} from './quote.js';

describe('the shared quote vectors', () => {
  it('has the cases the plan asks for', () => {
    const names = vectors.cases.map((vector) => vector.name).join('; ');
    expect(names).toMatch(/zero rates/);
    expect(names).toMatch(/100 percent discount/);
    expect(names).toMatch(/half a cent rounds up/);
  });

  it.each(vectors.cases)('$name', ({ lines, settings, totals }) => {
    for (const line of lines) {
      expect(lineTotalCents(line.quantity, line.unit as BomUnit, line.unitPriceCents)).toBe(
        line.lineTotalCents,
      );
    }
    expect(computeQuote(lines, settings as QuoteSettings)).toEqual(totals);
  });
});

describe('the shared unit price vectors', () => {
  const base = getEntry(SEED_CATALOG, 'base.standard')!;

  it.each(vectors.unitPrices)(
    '$name',
    ({ price, width, options, multiplierBps, unitPriceCents }) => {
      expect(entryUnitPriceCents({ ...base, price }, width, options, multiplierBps)).toBe(
        unitPriceCents,
      );
    },
  );
});

describe('computeQuote', () => {
  const settingsArb = fc.record({
    markupBps: fc.integer({ min: 0, max: 100000 }),
    discountBps: fc.integer({ min: 0, max: 10000 }),
    taxBps: fc.integer({ min: 0, max: 100000 }),
    currency: fc.constant('USD' as const),
  });
  const linesArb = fc.array(
    fc.record({ lineTotalCents: fc.integer({ min: 0, max: 50_000_000 }) }),
    { maxLength: 40 },
  );

  it('sums the lines into the subtotal, and every output is an integer', () => {
    fc.assert(
      fc.property(linesArb, settingsArb, (lines, settings) => {
        const totals = computeQuote(lines, settings);
        expect(totals.subtotalCents).toBe(lines.reduce((sum, l) => sum + l.lineTotalCents, 0));
        for (const cents of Object.values(totals)) {
          expect(Number.isSafeInteger(cents)).toBe(true);
          expect(cents).toBeGreaterThanOrEqual(0);
        }
        expect(totals.taxableCents).toBe(
          totals.subtotalCents + totals.markupCents - totals.discountCents,
        );
        expect(totals.totalCents).toBe(totals.taxableCents + totals.taxCents);
      }),
    );
  });

  it('is the subtotal with the default settings', () => {
    expect(computeQuote([{ lineTotalCents: 700 }], DEFAULT_QUOTE_SETTINGS).totalCents).toBe(700);
  });
});

describe('quoteSettingsProblem', () => {
  const settings = (patch: Partial<QuoteSettings>) => ({ ...DEFAULT_QUOTE_SETTINGS, ...patch });

  it('accepts whole basis points in range', () => {
    expect(quoteSettingsProblem(DEFAULT_QUOTE_SETTINGS)).toBeNull();
    expect(
      quoteSettingsProblem(settings({ markupBps: 100000, discountBps: 10000, taxBps: 825 })),
    ).toBeNull();
  });

  it('names the rate that is negative, fractional or too large', () => {
    expect(quoteSettingsProblem(settings({ markupBps: -1 }))).toMatch(/^Markup must be/);
    expect(quoteSettingsProblem(settings({ taxBps: 8.5 }))).toMatch(/^Tax must be/);
    expect(quoteSettingsProblem(settings({ discountBps: 10001 }))).toBe(
      'Discount must be between 0 and 100 percent, in steps of 0.01.',
    );
    expect(quoteSettingsProblem(settings({ taxBps: Number.NaN }))).toMatch(/^Tax must be/);
  });
});

describe('money', () => {
  it('rounds a half up and anything under it down', () => {
    expect(divideHalfUp(1, 2)).toBe(1);
    expect(divideHalfUp(49, 100)).toBe(0);
    expect(divideHalfUp(50, 100)).toBe(1);
    expect(divideHalfUp(150, 100)).toBe(2);
    expect(divideHalfUp(0, 7)).toBe(0);
    expect(applyBps(5, 1000)).toBe(1);
    expect(applyBps(4, 1000)).toBe(0);
  });

  it('formats cents as dollars', () => {
    expect(formatMoney(123450)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(99999)).toBe('$999.99');
    expect(formatMoney(100000)).toBe('$1,000.00');
    expect(formatMoney(123456789012)).toBe('$1,234,567,890.12');
    expect(formatMoney(-250)).toBe('-$2.50');
  });
});
