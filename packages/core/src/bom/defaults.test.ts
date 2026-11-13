import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUOTE_DEFAULTS,
  parseQuoteDefaults,
  quoteNumberLabel,
  settingsFromDefaults,
  validateQuoteDefaults,
} from './defaults.js';
import { DEFAULT_QUOTE_SETTINGS } from './quote.js';

// A 1 by 1 pixel RGB PNG.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

describe('the quote defaults', () => {
  it('start as no markup, discount or tax, in dollars, with empty branding', () => {
    expect(settingsFromDefaults(DEFAULT_QUOTE_DEFAULTS)).toEqual(DEFAULT_QUOTE_SETTINGS);
    expect(DEFAULT_QUOTE_DEFAULTS.branding).toEqual({
      numberPrefix: '',
      companyName: '',
      address: '',
      contact: '',
      logo: '',
      footerText: '',
    });
    expect(validateQuoteDefaults(undefined)).toEqual({ ok: true, value: DEFAULT_QUOTE_DEFAULTS });
  });

  it('take rates in basis points and branding, and trim the text', () => {
    const checked = validateQuoteDefaults({
      markupBps: 1500,
      taxBps: 825,
      branding: { companyName: '  Acme Kitchens ', numberPrefix: 'AK-', logo: PIXEL },
    });
    expect(checked.ok && checked.value).toMatchObject({
      markupBps: 1500,
      discountBps: 0,
      taxBps: 825,
      currency: 'USD',
      branding: { companyName: 'Acme Kitchens', numberPrefix: 'AK-', logo: PIXEL },
    });
    expect(checked.ok && settingsFromDefaults(checked.value)).toEqual({
      markupBps: 1500,
      discountBps: 0,
      taxBps: 825,
      currency: 'USD',
    });
  });

  it.each([
    [{ markupBps: -1 }, 'markupBps'],
    [{ markupBps: 100001 }, 'markupBps'],
    [{ discountBps: 10001 }, 'discountBps'],
    [{ taxBps: 1.5 }, 'taxBps'],
    [{ currency: 'EUR' }, 'currency'],
    [{ branding: { numberPrefix: 'no spaces' } }, 'branding.numberPrefix'],
    [{ branding: { numberPrefix: 'TOOLONGPREFIX' } }, 'branding.numberPrefix'],
    [{ branding: { companyName: 'x'.repeat(101) } }, 'branding.companyName'],
    [{ branding: { logo: 'https://example.com/logo.png' } }, 'branding.logo'],
    [{ branding: { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }, 'branding.logo'],
    [{ branding: { logo: `data:image/png;base64,${'A'.repeat(200_000)}` } }, 'branding.logo'],
    [{ branding: { colour: 'red' } }, 'branding'],
  ])('refuses %j', (input, path) => {
    const checked = validateQuoteDefaults(input);
    expect(!checked.ok && checked.error.map((issue) => issue.path)).toContain(path);
  });

  it('is read forgivingly in the browser: a bad value takes its default', () => {
    const parsed = parseQuoteDefaults({ markupBps: 500, taxBps: 'lots', branding: { logo: 'x' } });
    expect(parsed.ok && parsed.value.config).toEqual({
      ...DEFAULT_QUOTE_DEFAULTS,
      markupBps: 500,
    });
    expect(parsed.ok && parsed.value.ignored.map((issue) => issue.path)).toEqual([
      'taxBps',
      'branding.logo',
    ]);
  });

  it('puts the prefix before the number', () => {
    expect(quoteNumberLabel('', 3)).toBe('3');
    expect(quoteNumberLabel('EZ-', 3)).toBe('EZ-3');
  });
});
