import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatLength, IN, inches, isLen, parseLength, STEP, toInches } from './index.js';

describe('constants and conversions', () => {
  it('counts sixteenths of an inch', () => {
    expect(IN).toBe(16);
    expect(STEP).toBe(48);
    expect(inches(1)).toBe(16);
    expect(inches(3)).toBe(48);
    expect(inches(34.5)).toBe(552);
    expect(toInches(552)).toBe(34.5);
  });

  it('inches throws when the value is not exact to 1/16', () => {
    expect(() => inches(0.3)).toThrow(RangeError);
    expect(() => inches(Number.NaN)).toThrow(RangeError);
  });

  it('isLen accepts integers only', () => {
    expect(isLen(552)).toBe(true);
    expect(isLen(-16)).toBe(true);
    expect(isLen(0.5)).toBe(false);
    expect(isLen(Number.NaN)).toBe(false);
    expect(isLen('16')).toBe(false);
  });
});

describe('parseLength', () => {
  it.each([
    ['30', 480],
    ['30"', 480],
    ['30 in', 480],
    ['30in', 480],
    ['30 IN', 480],
    ['34.5', 552],
    ['34.50', 552],
    ['34.0625', 545],
    ['34.5"', 552],
    ['34 1/2', 552],
    ['34-1/2', 552],
    ['34 - 1/2', 552],
    ['34 1/2"', 552],
    ['34 1/2 in', 552],
    ['34  8/16', 552],
    ['1/2', 8],
    ['1/16"', 1],
    ['3/2', 24],
    ['0', 0],
    ['  30  ', 480],
    ['\t34 1/2"\n', 552],
    ['120 9/16', 1929],
  ])('accepts %j as %i', (text, expected) => {
    expect(parseLength(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['-30', 'NEGATIVE'],
    ['-1/2', 'NEGATIVE'],
    ["5'", 'UNSUPPORTED_UNIT'],
    ['5\' 6"', 'UNSUPPORTED_UNIT'],
    ['5 ft', 'UNSUPPORTED_UNIT'],
    ['5ft 6in', 'UNSUPPORTED_UNIT'],
    ['762 mm', 'UNSUPPORTED_UNIT'],
    ['76.2cm', 'UNSUPPORTED_UNIT'],
    ['1 m', 'UNSUPPORTED_UNIT'],
    ['30 inches of rain', 'UNSUPPORTED_UNIT'],
    ['0.3', 'INEXACT'],
    ['34.1', 'INEXACT'],
    ['34.06251', 'INEXACT'],
    ['1/3', 'INEXACT'],
    ['34 1/32', 'INEXACT'],
    ['abc', 'INVALID'],
    ['"', 'INVALID'],
    ['.5', 'INVALID'],
    ['30.', 'INVALID'],
    ['1/0', 'INVALID'],
    ['34 1', 'INVALID'],
    ['1/2/3', 'INVALID'],
    ['3 4 1/2', 'INVALID'],
    ['99999999999999999999', 'INVALID'],
    ['99999999999999999999/2', 'INVALID'],
    ['1/99999999999999999999', 'INVALID'],
  ])('rejects %j with %s', (text, code) => {
    const result = parseLength(text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(code);
    expect(!result.ok && result.error.message).not.toBe('');
  });
});

describe('formatLength', () => {
  it.each([
    [552, '34 1/2"'],
    [480, '30"'],
    [8, '1/2"'],
    [0, '0"'],
    [1929, '120 9/16"'],
    [1, '1/16"'],
    [12, '3/4"'],
    [-8, '-1/2"'],
    [-552, '-34 1/2"'],
  ])('formats %i as %s', (len, text) => {
    expect(formatLength(len)).toBe(text);
  });

  it('rounds a derived value to the nearest 1/16 in', () => {
    expect(formatLength(551.6)).toBe('34 1/2"');
  });
});

describe('round trip', () => {
  it('parseLength(formatLength(x)) === x for every non-negative Len', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), (x) => {
        expect(parseLength(formatLength(x))).toEqual({ ok: true, value: x });
      }),
      { numRuns: 2000 },
    );
  });

  it('holds for every Len up to 20 ft', () => {
    for (let x = 0; x <= 240 * IN; x += 1) {
      expect(parseLength(formatLength(x))).toEqual({ ok: true, value: x });
    }
  });
});
