import type { FinishTarget, Item, ItemKind, Placement } from '../document/index.js';
import type { Len } from '../units/index.js';

/** Which widths an entry comes in. Only fillers are `free`. */
export type WidthRule =
  { min: Len; max: Len; step: Len } | { values: Len[] } | { free: { min: Len; max: Len } };

/** One option of an entry. An item that leaves the option out gets `default`. */
export type OptionDef =
  | { key: string; type: 'enum'; values: string[]; default: string }
  | { key: string; type: 'int'; values: number[]; default: number }
  | { key: string; type: 'int'; range: { min: number; max: number }; default: number }
  | { key: string; type: 'bool'; default: boolean };

/**
 * How a corner entry fills its corner. Every corner item's `width` runs along the wall it
 * is placed on.
 * - `blind`: a straight cabinet whose `blind` side tucks behind the run on the adjacent
 *   wall. `depth` is front to back.
 * - `l` and `diagonal`: the corner is at the item's left end, where its wall starts.
 *   `depth` runs along the adjacent wall and must equal `width`.
 */
export type CornerShape = 'blind' | 'l' | 'diagonal';

export type CatalogEntry = {
  /** For example `base.standard`. */
  id: string;
  kind: ItemKind;
  name: string;
  width: WidthRule;
  heights: Len[];
  depths: Len[];
  /** The size `defaultItemFor` gives a new item. Each value is an allowed one. */
  defaultSize: { width: Len; height: Len; depth: Len };
  defaultElevation: Len;
  options: OptionDef[];
  placement: Placement['type'][];
  /** Entries of kind `corner` only. */
  corner?: CornerShape;
  price: {
    baseCents: number;
    perInchWidthCents: number;
    /** Added per option value, keyed as `key=value`: `{ 'topDrawer=true': 2500 }`. */
    optionCents?: Record<string, number>;
  };
};

export type Finish = {
  id: string;
  name: string;
  target: FinishTarget;
  /** `#rrggbb`. */
  color: string;
};

export type Catalog = { version: string; entries: CatalogEntry[]; finishes: Finish[] };

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
