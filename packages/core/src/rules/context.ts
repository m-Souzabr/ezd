import {
  type Catalog,
  type CatalogEntry,
  checkItemAgainstCatalog,
  type ConstraintError,
} from '../catalog/index.js';
import type { DesignDocument, Id, Item, ItemKind, Opening, Wall } from '../document/index.js';
import {
  EPS,
  type Footprint,
  itemFootprint,
  type Pt,
  rectsOverlap,
  wallDirection,
  wallLength,
  wallNormal,
} from '../geometry/index.js';
import { formatLength, type Len } from '../units/index.js';

// What every rule reads: the document, indexed once per `validate` call.

export type WallInfo = {
  wall: Wall;
  /** A, B, C in document order. */
  label: string;
  /** Rounded to the nearest 1/16 in, so checks along the wall are integer math. */
  length: Len;
  /** The wall's own height, or the ceiling height if that is lower. */
  height: Len;
  direction: Pt;
  normal: Pt;
  /** In document order. */
  items: PlacedItem[];
  openings: Opening[];
  /** The wall that ends where this one starts, and the one that starts where it ends. */
  prev: WallInfo | undefined;
  next: WallInfo | undefined;
};

export type PlacedItem = {
  item: Item;
  entry: CatalogEntry | undefined;
  /** For messages: `Base cabinet 30" at 12" on wall A`. */
  label: string;
  /** Position in `doc.items`. */
  index: number;
  /** What `checkItemAgainstCatalog` says about the item. */
  errors: ConstraintError[];
  footprint: Footprint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  bottom: Len;
  top: Len;
  /** Set for an item placed on a wall, with its interval along that wall. */
  wall: WallInfo | undefined;
  start: Len;
  end: Len;
};

export type RuleContext = {
  doc: DesignDocument;
  catalog: Catalog;
  walls: WallInfo[];
  /** In document order. */
  items: PlacedItem[];
  itemById: Map<Id, PlacedItem>;
  /**
   * Each pair of items whose bounding boxes in plan are less than `margin` apart, the
   * earlier item first, in document order.
   */
  pairsWithin(margin: number): [PlacedItem, PlacedItem][];
  /** Each pair of items that overlap in plan and in height, in document order. */
  overlaps(): [PlacedItem, PlacedItem][];
  /** An id no entity has and no earlier call returned: `filler-01`. For fixes. */
  newId(prefix: string): Id;
};

const KIND_NAMES: Record<ItemKind, string> = {
  base: 'Base cabinet',
  wall: 'Wall cabinet',
  tall: 'Tall cabinet',
  corner: 'Corner cabinet',
  appliance: 'Appliance',
  filler: 'Filler',
  panel: 'Panel',
};

function letters(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}

/** The wall's name in messages: A, B, C in document order, then AA, AB after Z. */
export function wallLabel(doc: DesignDocument, wallId: Id): string {
  const index = doc.room.walls.findIndex((wall) => wall.id === wallId);
  return index === -1 ? '?' : letters(index);
}

/** `Base cabinet 30"` becomes `the base cabinet 30"`, for the middle of a sentence. */
export const the = (label: string): string =>
  `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

/** `the door at 42"`, or `the door at 42" on wall C` with `withWall`. */
export const openingLabel = (opening: Opening, wall?: WallInfo): string =>
  `the ${opening.kind} at ${formatLength(opening.offset)}${wall ? ` on wall ${wall.label}` : ''}`;

export const verticalOverlap = (a: PlacedItem, b: PlacedItem): boolean =>
  a.bottom < b.top && b.bottom < a.top;

/** Exact along a shared wall; a separating-axis test otherwise. Touching is not overlap. */
export const planOverlap = (a: PlacedItem, b: PlacedItem): boolean =>
  a.wall && a.wall === b.wall
    ? a.start < b.end && b.start < a.end
    : rectsOverlap(a.footprint, b.footprint);

/** Whether the items are on two walls that meet in a corner. */
export const meetInCorner = (a: PlacedItem, b: PlacedItem): boolean =>
  a.wall !== undefined &&
  b.wall !== undefined &&
  a.wall !== b.wall &&
  (a.wall.next === b.wall || b.wall.next === a.wall);

const samePoint = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

export function createContext(doc: DesignDocument, catalog: Catalog): RuleContext {
  const entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const { ceilingHeight } = doc.room;

  const walls = doc.room.walls.map((wall, index): WallInfo => ({
    wall,
    label: letters(index),
    length: Math.round(wallLength(wall)),
    height: Math.min(wall.height ?? ceilingHeight, ceilingHeight),
    direction: wallDirection(wall),
    normal: wallNormal(wall),
    items: [],
    openings: [],
    prev: undefined,
    next: undefined,
  }));
  const wallById = new Map(walls.map((info) => [info.wall.id, info]));
  for (const info of walls) {
    info.prev = walls.find((other) => other !== info && samePoint(other.wall.end, info.wall.start));
    info.next = walls.find((other) => other !== info && samePoint(other.wall.start, info.wall.end));
  }
  for (const opening of doc.room.openings) wallById.get(opening.wallId)?.openings.push(opening);

  const items: PlacedItem[] = [];
  for (const [index, item] of doc.items.entries()) {
    const { placement } = item;
    const footprint = itemFootprint(doc, item);
    // Null only for an item on a wall the document lacks, which a valid document rules out.
    if (!footprint) continue;
    const wall = placement.type === 'wall' ? wallById.get(placement.wallId) : undefined;
    const start = placement.type === 'wall' ? placement.offset : 0;
    const entry = entries.get(item.catalogId);
    // The seed names say how a corner cabinet is measured, in brackets. Leave that out.
    const name = entry ? entry.name.replace(/\s*\(.*\)$/, '') : KIND_NAMES[item.kind];
    const where = wall ? `at ${formatLength(start)} on wall ${wall.label}` : '(free-standing)';
    const xs = footprint.map((p) => p.x);
    const ys = footprint.map((p) => p.y);
    const placed: PlacedItem = {
      item,
      entry,
      index,
      label: `${name} ${formatLength(item.width)} ${where}`,
      errors: checkItemAgainstCatalog(item, catalog),
      footprint,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      bottom: item.elevation,
      top: item.elevation + item.height,
      wall,
      start,
      end: start + (wall ? item.width : 0),
    };
    items.push(placed);
    wall?.items.push(placed);
  }

  let byMinX: PlacedItem[] | undefined;
  let overlapping: [PlacedItem, PlacedItem][] | undefined;
  const used = new Set<Id>(
    [doc.room.walls, doc.room.openings, doc.items, doc.countertops].flatMap((list) =>
      list.map((entity) => entity.id),
    ),
  );
  const serials = new Map<string, number>();

  return {
    doc,
    catalog,
    walls,
    items,
    itemById: new Map(items.map((placed) => [placed.item.id, placed])),
    pairsWithin(margin) {
      // Sweep along x, so only items near each other are compared.
      byMinX ??= [...items].sort((a, b) => a.minX - b.minX);
      const pairs: [PlacedItem, PlacedItem][] = [];
      for (let i = 0; i < byMinX.length; i += 1) {
        const a = byMinX[i]!;
        for (let j = i + 1; j < byMinX.length; j += 1) {
          const b = byMinX[j]!;
          if (b.minX - a.maxX >= margin) break;
          if (b.minY - a.maxY >= margin || a.minY - b.maxY >= margin) continue;
          pairs.push(a.index < b.index ? [a, b] : [b, a]);
        }
      }
      return pairs.sort(([a, b], [c, d]) => a.index - c.index || b.index - d.index);
    },
    overlaps() {
      overlapping ??= this.pairsWithin(-EPS).filter(
        ([a, b]) => verticalOverlap(a, b) && planOverlap(a, b),
      );
      return overlapping;
    },
    newId(prefix) {
      let id: Id;
      let serial = serials.get(prefix) ?? 0;
      do {
        serial += 1;
        id = `${prefix}-${String(serial).padStart(2, '0')}`;
      } while (used.has(id));
      serials.set(prefix, serial);
      return id;
    },
  };
}
