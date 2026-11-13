import { describe, expect, it } from 'vitest';

import { formatPercent, parsePercent, quoteDate, sizeText } from './format';

describe('parsePercent', () => {
  it('reads up to two decimals as basis points', () => {
    expect(parsePercent('8.25')).toBe(825);
    expect(parsePercent('8.5')).toBe(850);
    expect(parsePercent('0')).toBe(0);
    expect(parsePercent(' 20 % ')).toBe(2000);
    expect(parsePercent('100')).toBe(10000);
  });

  it('refuses anything else', () => {
    for (const text of ['', '-1', '8.255', 'abc', '1e2', '.5', '8,25']) {
      expect(parsePercent(text)).toBeNull();
    }
  });
});

describe('formatPercent', () => {
  it('writes basis points back as a percentage', () => {
    expect(formatPercent(825)).toBe('8.25');
    expect(formatPercent(850)).toBe('8.50');
    expect(formatPercent(2000)).toBe('20');
    expect(formatPercent(5)).toBe('0.05');
  });
});

describe('quoteDate', () => {
  it('is the date in UTC, in words', () => {
    expect(quoteDate('2026-11-12T23:30:00Z')).toBe('November 12, 2026');
    expect(quoteDate('2026-01-01T00:00:00-06:00')).toBe('January 1, 2026');
  });
});

describe('sizeText', () => {
  it('is width, height and depth in inches', () => {
    expect(sizeText({ width: 480, height: 552, depth: 384 })).toBe('30" x 34 1/2" x 24"');
  });
});
