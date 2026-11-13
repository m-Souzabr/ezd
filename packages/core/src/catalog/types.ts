import type { z } from 'zod';

import type { Item, Placement } from '../document/index.js';
import type { Len } from '../units/index.js';
import type {
  CatalogEntrySchema,
  CatalogSchema,
  CornerShapeSchema,
  FinishSchema,
  OptionDefSchema,
  WidthRuleSchema,
} from './schema.js';

/** Which widths an entry comes in. Only fillers are `free`. */
export type WidthRule = z.infer<typeof WidthRuleSchema>;

/** One option of an entry. An item that leaves the option out gets `default`. */
export type OptionDef = z.infer<typeof OptionDefSchema>;

/**
 * How a corner entry fills its corner. Every corner item's `width` runs along the wall it
 * is placed on.
 * - `blind`: a straight cabinet whose `blind` side tucks behind the run on the adjacent
 *   wall. `depth` is front to back.
 * - `l` and `diagonal`: the corner is at the item's left end, where its wall starts.
 *   `depth` runs along the adjacent wall and must equal `width`.
 */
export type CornerShape = z.infer<typeof CornerShapeSchema>;

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export type Finish = z.infer<typeof FinishSchema>;

/** The price multiplier of a finish that does not set one: no change. */
export const DEFAULT_MULTIPLIER_BPS = 10000;

export type Catalog = z.infer<typeof CatalogSchema>;

/** Entries that can be added to a design: every one that is not retired. */
export const activeEntries = (catalog: Catalog): CatalogEntry[] =>
  catalog.entries.filter((entry) => !entry.retired);

export const getEntry = (catalog: Catalog, id: string): CatalogEntry | undefined =>
  catalog.entries.find((entry) => entry.id === id);

/** Every width the entry comes in, ascending. For a filler, every sixteenth in its range. */
export function allowedWidths(entry: CatalogEntry): Len[] {
  const { width } = entry;
  if ('values' in width) return [...width.values].sort((a, b) => a - b);
  const { min, max, step } = 'free' in width ? { ...width.free, step: 1 } : width;
  const widths: Len[] = [];
  for (let w = min; w <= max; w += step) widths.push(w);
  return widths;
}

/**
 * A new item of the entry at its default size, elevation and options. Free-standing at
 * the room origin unless `placement` says otherwise; an entry that only goes on a wall
 * needs one.
 */
export function defaultItemFor(
  entry: CatalogEntry,
  id: string,
  placement: Placement = { type: 'free', x: 0, y: 0, rotation: 0 },
): Item {
  return {
    id,
    catalogId: entry.id,
    kind: entry.kind,
    ...entry.defaultSize,
    elevation: entry.defaultElevation,
    placement,
    options: Object.fromEntries(entry.options.map((option) => [option.key, option.default])),
  };
}
