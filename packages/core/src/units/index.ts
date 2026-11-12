import { err, ok, type Result } from '../result.js';

/** A length: an integer count of sixteenths of an inch. */
export type Len = number;

/** 1 inch. */
export const IN = 16;
/** 3 inches, the cabinet width step. */
export const STEP = 3 * IN;

export const isLen = (n: unknown): n is Len => Number.isSafeInteger(n);

/**
 * Converts a literal number of inches to a `Len`: `inches(34.5) === 552`.
 * For constants in code. Throws if the value is not exact to 1/16 in; parse user input
 * with `parseLength` instead.
 */
export const inches = (n: number): Len => {
  const len = n * IN;
  if (!isLen(len)) throw new RangeError(`${n} in is not exact to 1/16 in`);
  return len;
};

/** `552 -> 34.5`. For math and display only; never store the result. */
export const toInches = (l: Len): number => l / IN;

export type ParseError = {
  code: 'EMPTY' | 'NEGATIVE' | 'UNSUPPORTED_UNIT' | 'INEXACT' | 'INVALID';
  message: string;
};

const fail = (code: ParseError['code'], message: string): Result<never, ParseError> =>
  err({ code, message });

const INCH_UNITS = new Set(['"', 'in']);
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const FRACTION = /^(?:(\d+)(?:\s+|\s*-\s*))?(\d+)\s*\/\s*(\d+)$/;
// 1/16 = 0.0625, so an exact decimal has at most four fractional digits.
const MAX_FRACTION_DIGITS = 4;

/**
 * Parses a length typed by a user, in inches: `30`, `30"`, `30 in`, `34.5`, `34 1/2`,
 * `34-1/2`, `34 1/2"`, `1/2`. Rejects negatives, empty text, any other unit and any value
 * not exact to 1/16 in.
 */
export function parseLength(text: string): Result<Len, ParseError> {
  const trimmed = text.trim();
  if (trimmed === '') return fail('EMPTY', 'Enter a length in inches.');
  if (trimmed.startsWith('-')) return fail('NEGATIVE', 'A length cannot be negative.');

  // The number is everything up to the first character that cannot be part of one.
  const unitStart = trimmed.search(/[^\d\s./-]/);
  const body = (unitStart === -1 ? trimmed : trimmed.slice(0, unitStart)).trimEnd();
  const unit = unitStart === -1 ? '' : trimmed.slice(unitStart).toLowerCase();
  if (body === '') return fail('INVALID', `"${trimmed}" is not a length.`);
  if (unit !== '' && !INCH_UNITS.has(unit)) {
    return fail('UNSUPPORTED_UNIT', `Lengths are in inches only, for example 34 1/2".`);
  }

  const inexact = () => fail('INEXACT', `"${trimmed}" is not exact to 1/16 in.`);
  let len: number;

  const decimal = DECIMAL.exec(body);
  const fraction = FRACTION.exec(body);
  if (decimal) {
    const digits = (decimal[2] ?? '').replace(/0+$/, '');
    if (digits.length > MAX_FRACTION_DIGITS) return inexact();
    const scale = 10 ** digits.length;
    const sixteenths = (Number(digits) * IN) / scale;
    if (!Number.isInteger(sixteenths)) return inexact();
    len = Number(decimal[1]) * IN + sixteenths;
  } else if (fraction) {
    const numerator = Number(fraction[2]) * IN;
    const denominator = Number(fraction[3]);
    if (denominator === 0) return fail('INVALID', `"${trimmed}" divides by zero.`);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      return fail('INVALID', `"${trimmed}" is too large.`);
    }
    if (numerator % denominator !== 0) return inexact();
    len = Number(fraction[1] ?? 0) * IN + numerator / denominator;
  } else {
    return fail('INVALID', `"${trimmed}" is not a length.`);
  }

  if (!isLen(len)) return fail('INVALID', `"${trimmed}" is too large.`);
  return ok(len);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Formats a length as whole inches plus a reduced fraction: `552 -> 34 1/2"`.
 * A derived, non-integer value is rounded to the nearest 1/16 in.
 */
export function formatLength(l: Len): string {
  const rounded = Math.round(l);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / IN);
  const rest = abs % IN;
  if (rest === 0) return `${sign}${whole}"`;
  const divisor = gcd(rest, IN);
  const fraction = `${rest / divisor}/${IN / divisor}`;
  return whole === 0 ? `${sign}${fraction}"` : `${sign}${whole} ${fraction}"`;
}
