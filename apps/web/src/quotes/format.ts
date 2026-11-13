import { type BomLine, formatLength } from '@ezd/core';

/** `30" x 34 1/2" x 24"`: width, height, depth. */
export const sizeText = (line: Pick<BomLine, 'width' | 'height' | 'depth'>): string =>
  `${formatLength(line.width)} x ${formatLength(line.height)} x ${formatLength(line.depth)}`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `November 12, 2026`, in UTC. Not `Intl`, whose output depends on the browser and the
 * time zone, so a quote's date reads the same on every machine.
 */
export function quoteDate(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** `8.25` percent as 825 basis points. Null for anything else than up to two decimals. */
export function parsePercent(text: string): number | null {
  const match = /^\s*(\d{1,6})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** 825 basis points as `8.25`. */
export const formatPercent = (bps: number): string =>
  bps % 100 === 0
    ? String(bps / 100)
    : `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
