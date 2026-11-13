import type { Catalog } from '../catalog/index.js';
import { formatLength } from '../units/index.js';
import type { BomLine } from './bom.js';
import { formatMoney } from './money.js';

/** `2550` hundredths of a square foot becomes `25.50`. */
export function formatQuantity(line: Pick<BomLine, 'quantity' | 'unit'>): string {
  if (line.unit === 'each') return String(line.quantity);
  return `${Math.floor(line.quantity / 100)}.${String(line.quantity % 100).padStart(2, '0')}`;
}

/** The finish as the catalog names it, or an empty string. */
export const finishName = (catalog: Catalog, finishId: string | null): string =>
  catalog.finishes.find((finish) => finish.id === finishId)?.name ?? finishId ?? '';

const HEADER = [
  'Qty',
  'Unit',
  'Description',
  'Width',
  'Height',
  'Depth',
  'Finish',
  'Unit price',
  'Line total',
];

/** Quoted when it holds a comma, a quote or a line break, as RFC 4180 asks. */
const cell = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

/**
 * The bill of materials as CSV, one row per line. Lengths are inches with fractions
 * (`34 1/2"`), as everywhere a person reads them.
 */
export function bomToCsv(lines: readonly BomLine[], catalog: Catalog): string {
  const rows = lines.map((line) => [
    formatQuantity(line),
    line.unit,
    line.description,
    formatLength(line.width),
    formatLength(line.height),
    formatLength(line.depth),
    finishName(catalog, line.finishId),
    formatMoney(line.unitPriceCents),
    formatMoney(line.lineTotalCents),
  ]);
  return [HEADER, ...rows].map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}
