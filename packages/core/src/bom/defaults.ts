import { z } from 'zod';

import { parseForgiving } from '../config/parse.js';
import { type Issue, issuePath } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { MAX_DISCOUNT_BPS, MAX_RATE_BPS, type QuoteSettings } from './quote.js';

// The Control Panel's defaults for a new quote and the branding of its PDF. Every field is
// optional and its default is what quotes did before this existed.

/** What a logo may be: a PNG without an alpha channel or a JPEG, as a data URI. */
export const LOGO_PATTERN = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
/** The logo's data URI, in characters: about 150 KB of image. */
export const MAX_LOGO_CHARS = 200_000;

const Text = (max: number) => z.string().trim().max(max).default('');

const rate = (max: number) => z.number().int().min(0).max(max).default(0);

/** The company's name, contact details and look on a quote's PDF. Snapshotted into each quote. */
export const QuoteBrandingSchema = z
  .strictObject({
    /** Put before the quote's number: `EZ-` makes `EZ-3`. */
    numberPrefix: z
      .string()
      .trim()
      .max(10)
      .regex(/^[A-Za-z0-9._-]*$/, 'Letters, digits, dots, dashes and underscores only.')
      .default(''),
    companyName: Text(100),
    address: Text(300),
    contact: Text(300),
    /** A data URI, or empty for no logo. */
    logo: z
      .string()
      .max(MAX_LOGO_CHARS, 'The logo is too large. Use an image under 150 KB.')
      .refine(
        (value) => value === '' || LOGO_PATTERN.test(value),
        'The logo must be a PNG or JPEG.',
      )
      .default(''),
    footerText: Text(500),
  })
  .prefault({});

export const QuoteDefaultsSchema = z
  .strictObject({
    markupBps: rate(MAX_RATE_BPS),
    discountBps: rate(MAX_DISCOUNT_BPS),
    taxBps: rate(MAX_RATE_BPS),
    currency: z.literal('USD').default('USD'),
    branding: QuoteBrandingSchema,
  })
  .prefault({});

export type QuoteDefaults = z.output<typeof QuoteDefaultsSchema>;
export type QuoteDefaultsInput = z.input<typeof QuoteDefaultsSchema>;
export type QuoteBranding = QuoteDefaults['branding'];

export const DEFAULT_QUOTE_DEFAULTS: QuoteDefaults = QuoteDefaultsSchema.parse({});

/** The rates of a new quote, which the form starts from. */
export const settingsFromDefaults = (defaults: QuoteDefaults): QuoteSettings => ({
  markupBps: defaults.markupBps,
  discountBps: defaults.discountBps,
  taxBps: defaults.taxBps,
  currency: defaults.currency,
});

/** How a quote is named: its number with the configured prefix, as `EZ-3`. */
export const quoteNumberLabel = (prefix: string, number: number): string => `${prefix}${number}`;

/** Checks `input` strictly: an unknown key or a bad value is an issue. Fills the defaults. */
export function validateQuoteDefaults(input: unknown): Result<QuoteDefaults, Issue[]> {
  const parsed = QuoteDefaultsSchema.safeParse(input ?? {});
  if (parsed.success) return ok(parsed.data);
  return err(
    parsed.error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message })),
  );
}

/** Reads the quote defaults from anywhere and never refuses an object: a bad value takes its default. */
export const parseQuoteDefaults = (input: unknown) =>
  parseForgiving(QuoteDefaultsSchema, DEFAULT_QUOTE_DEFAULTS, input, 'quote defaults');
