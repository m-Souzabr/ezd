import {
  type Catalog,
  type CatalogEntry,
  DEFAULT_MULTIPLIER_BPS,
  type Finish,
  getEntry,
} from '../catalog/index.js';
import type { DesignDocument, Id, Item, ItemKind } from '../document/index.js';
import { IN, type Len } from '../units/index.js';
import { BPS, divideHalfUp } from './money.js';

export type BomUnit = 'each' | 'sqft';

export type BomLine = {
  /** What the line groups by. Unique within one bill of materials. */
  key: string;
  /** The catalog entry, or `countertop` for a countertop line. */
  catalogId: string;
  /** For example `Base cabinet, 2 doors, top drawer, hinge left`. */
  description: string;
  /**
   * The size of one piece. On a countertop line, which adds slabs up: the total length,
   * the thickness of the thickest slab and the depth of the deepest.
   */
  width: Len;
  height: Len;
  depth: Len;
  /** The resolved finish. Null for appliances and when the catalog has no finish. */
  finishId: string | null;
  /** Every option of the entry, with its default where the item sets none. */
  options: Record<string, string | number | boolean>;
  /** Pieces, or hundredths of a square foot for a countertop line. */
  quantity: number;
  unit: BomUnit;
  /** For one piece, or for one square foot. */
  unitPriceCents: number;
  lineTotalCents: number;
  /** The items or countertops the line counts. */
  itemIds: Id[];
};

/** What a countertop line has in place of a catalog entry id. */
export const COUNTERTOP_CATALOG_ID = 'countertop';

const SQIN_PER_SQFT = 144;
/** A quantity in square feet is stored in hundredths. */
const SQFT_SCALE = 100;

type SortKind = ItemKind | 'countertop';
const KIND_ORDER: readonly SortKind[] = [
  'base',
  'wall',
  'tall',
  'corner',
  'appliance',
  'filler',
  'panel',
  'countertop',
];

/**
 * What a line costs: pieces times the unit price, or square feet times the price of one.
 * A quantity in square feet is in hundredths, so that product is rounded half up to a
 * cent. The server checks every stored line against the same rule.
 */
export function lineTotalCents(quantity: number, unit: BomUnit, unitPriceCents: number): number {
  return unit === 'each'
    ? quantity * unitPriceCents
    : divideHalfUp(quantity * unitPriceCents, SQFT_SCALE);
}

const findFinish = (catalog: Catalog, id: string | null): Finish | undefined =>
  id === null ? undefined : catalog.finishes.find((finish) => finish.id === id);

const defaultFinishId = (
  doc: DesignDocument,
  catalog: Catalog,
  target: 'cabinet' | 'countertop',
): string | null =>
  doc.finishes[target] ?? catalog.finishes.find((finish) => finish.target === target)?.id ?? null;

/** The item's options with the entry's default for each one it leaves out. */
function resolvedOptions(item: Item, entry: CatalogEntry | undefined): BomLine['options'] {
  const defaults = Object.fromEntries(
    (entry?.options ?? []).map((option) => [option.key, option.default]),
  );
  const merged = { ...defaults, ...item.options };
  // Sorted, so two items with the same options make the same key whatever their order.
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** `topDrawer` becomes `top drawer`. */
const words = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** `Base cabinet, 2 doors, top drawer, hinge left`, in the order the entry lists its options. */
function describe(entry: CatalogEntry, options: BomLine['options']): string {
  const parts = entry.options.flatMap((option) => {
    const value = options[option.key];
    if (typeof value === 'number') {
      const name = words(option.key);
      return [`${value} ${value === 1 ? name.replace(/s$/, '') : name}`];
    }
    if (typeof value === 'boolean') return value ? [words(option.key)] : [];
    return [`${words(option.key)} ${value}`];
  });
  return [entry.name, ...parts].join(', ');
}

/**
 * The price of one item: the base price, plus the price per inch of width, plus each
 * option's price, all times the finish multiplier. A filler's width may be a fraction of
 * an inch, so the sum is kept in sixteenths of a cent and rounded half up once.
 */
function unitPrice(item: Item, entry: CatalogEntry, options: BomLine['options'], bps: number) {
  const { baseCents, perInchWidthCents, optionCents = {} } = entry.price;
  const optionsCents = Object.entries(options).reduce(
    (sum, [key, value]) => sum + (optionCents[`${key}=${String(value)}`] ?? 0),
    0,
  );
  const sixteenths = (baseCents + optionsCents) * IN + perInchWidthCents * item.width;
  return divideHalfUp(sixteenths * bps, IN * BPS);
}

function itemLine(item: Item, catalog: Catalog, cabinetFinish: string | null): BomLine {
  const entry = getEntry(catalog, item.catalogId);
  const finishId = item.kind === 'appliance' ? null : (item.finishId ?? cabinetFinish);
  const options = resolvedOptions(item, entry);
  const bps = findFinish(catalog, finishId)?.multiplierBps ?? DEFAULT_MULTIPLIER_BPS;
  return {
    key: [
      item.catalogId,
      item.kind,
      item.width,
      item.height,
      item.depth,
      finishId ?? '',
      JSON.stringify(options),
    ].join('|'),
    catalogId: item.catalogId,
    // An item whose entry is not in the catalog is still counted, at no price.
    description: entry ? describe(entry, options) : item.catalogId,
    width: item.width,
    height: item.height,
    depth: item.depth,
    finishId,
    options,
    quantity: 1,
    unit: 'each',
    unitPriceCents: entry ? unitPrice(item, entry, options, bps) : 0,
    lineTotalCents: 0,
    itemIds: [item.id],
  };
}

/**
 * The bill of materials of a design: one line for each group of identical items, and one
 * for the countertops of each finish. Every item and countertop is in exactly one line.
 *
 * Lines are sorted by kind (base, wall, tall, corner, appliance, filler, panel,
 * countertop), then width, then catalog id.
 */
export function computeBom(doc: DesignDocument, catalog: Catalog): BomLine[] {
  const lines = new Map<string, BomLine & { kind: SortKind }>();

  const cabinetFinish = defaultFinishId(doc, catalog, 'cabinet');
  for (const item of doc.items) {
    const line = itemLine(item, catalog, cabinetFinish);
    const same = lines.get(line.key);
    if (same) {
      same.quantity += 1;
      same.itemIds.push(item.id);
    } else {
      lines.set(line.key, { ...line, kind: item.kind });
    }
  }

  // Countertops add up by finish. The area is kept exact, in square sixteenths of an
  // inch, until the line's total is known.
  const countertopFinish = defaultFinishId(doc, catalog, 'countertop');
  const areas = new Map<string, number>();
  for (const countertop of doc.countertops) {
    const finishId = countertop.finishId ?? countertopFinish;
    const key = `${COUNTERTOP_CATALOG_ID}|${finishId ?? ''}`;
    const length = countertop.endOffset - countertop.startOffset;
    areas.set(key, (areas.get(key) ?? 0) + length * countertop.depth);
    const same = lines.get(key);
    if (same) {
      same.width += length;
      same.height = Math.max(same.height, countertop.thickness);
      same.depth = Math.max(same.depth, countertop.depth);
      same.itemIds.push(countertop.id);
      continue;
    }
    const finish = findFinish(catalog, finishId);
    lines.set(key, {
      key,
      kind: 'countertop',
      catalogId: COUNTERTOP_CATALOG_ID,
      description: finish ? `Countertop, ${finish.name}` : 'Countertop',
      width: length,
      height: countertop.thickness,
      depth: countertop.depth,
      finishId,
      options: {},
      quantity: 0,
      unit: 'sqft',
      unitPriceCents: finish?.pricePerSqftCents ?? 0,
      lineTotalCents: 0,
      itemIds: [countertop.id],
    });
  }
  for (const [key, area] of areas) {
    // Hundredths of a square foot, rounded up: a sliver of stone is still bought.
    lines.get(key)!.quantity = Math.ceil((area * SQFT_SCALE) / (IN * IN * SQIN_PER_SQFT));
  }

  return [...lines.values()]
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.width - b.width ||
        compare(a.catalogId, b.catalogId) ||
        compare(a.key, b.key),
    )
    .map((sorted) => {
      const line: BomLine & { kind?: SortKind } = { ...sorted };
      delete line.kind;
      line.lineTotalCents = lineTotalCents(line.quantity, line.unit, line.unitPriceCents);
      return line;
    });
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
