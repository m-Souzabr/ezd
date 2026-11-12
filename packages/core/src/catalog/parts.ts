import type { Item, OptionValue } from '../document/index.js';
import { inches, type Len } from '../units/index.js';
import {
  BASE_CABINET_DEPTH,
  FRONT_REVEAL,
  MAX_SHELF_SPACING,
  OVEN_OPENING_HEIGHT,
  PANEL_THICKNESS,
  TOE_KICK_DEPTH,
  TOE_KICK_HEIGHT,
  TOP_DRAWER_FRONT_HEIGHT,
  WALL_CABINET_DEPTH,
  WALL_CABINET_ELEVATION,
} from './constants.js';
import { optionAllows } from './constraints.js';
import { type Catalog, type CatalogEntry, getEntry } from './types.js';

export type PartRole =
  | 'side'
  | 'bottom'
  | 'top'
  | 'back'
  | 'shelf'
  | 'door'
  | 'drawer-front'
  | 'toe-kick'
  | 'body'
  | 'filler'
  | 'panel';

/** Local to the item: x along its width, y up from its bottom, z from its back. */
export type Box = { x: Len; y: Len; z: Len; w: Len; h: Len; d: Len };

export type Part = {
  role: PartRole;
  box: Box;
  /**
   * Only the parts of a diagonal corner have one. Integer degrees, clockwise seen from
   * above, about the vertical line through the box's (x, z) corner: `w` then runs along
   * (cos, sin) in the x-z plane and `d` along (-sin, cos), as for a free-standing item.
   */
  rotation?: number;
  finishSlot: 'carcass' | 'front' | 'appliance' | 'none';
};

const T = PANEL_THICKNESS;
// Fronts stop half a reveal short of the cabinet's edges, so neighbouring cabinets show
// the same reveal as neighbouring fronts.
const EDGE = FRONT_REVEAL / 2;

const carcass = (role: PartRole, box: Box): Part => ({ role, box, finishSlot: 'carcass' });
const front = (role: 'door' | 'drawer-front', box: Box): Part => ({
  role,
  box,
  finishSlot: 'front',
});

/** The item's option, or the entry's default when the item has none or an invalid one. */
function option(item: Item, entry: CatalogEntry, key: string): OptionValue | undefined {
  const def = entry.options.find((candidate) => candidate.key === key);
  if (!def) return undefined;
  const value = item.options[key];
  return value !== undefined && optionAllows(def, value) ? value : def.default;
}
const count = (item: Item, entry: CatalogEntry, key: string, fallback: number): number => {
  const value = option(item, entry, key);
  return typeof value === 'number' ? value : fallback;
};

/**
 * Splits `[start, end]` into `n` spans separated by a reveal. Whole sixteenths only: the
 * first spans take the remainder.
 */
function spans(start: Len, end: Len, n: number): { at: Len; size: Len }[] {
  const available = end - start - FRONT_REVEAL * (n - 1);
  const size = Math.floor(available / n);
  const extra = available - size * n;
  const out: { at: Len; size: Len }[] = [];
  let at = start;
  for (let i = 0; i < n; i += 1) {
    const span = size + (i < extra ? 1 : 0);
    out.push({ at, size: span });
    at += span + FRONT_REVEAL;
  }
  return out;
}

/** `columns` doors side by side over the front, from `y0` up to `y1`. */
const doorRow = (item: Item, y0: Len, y1: Len, columns: number): Part[] =>
  spans(EDGE, item.width - EDGE, columns).map(({ at, size }) =>
    front('door', { x: at, y: y0, z: item.depth, w: size, h: y1 - y0, d: T }),
  );

/** One full-width drawer front from `y0` up to `y1`. */
const drawerFront = (item: Item, y0: Len, y1: Len): Part =>
  front('drawer-front', {
    x: EDGE,
    y: y0,
    z: item.depth,
    w: item.width - FRONT_REVEAL,
    h: y1 - y0,
    d: T,
  });

/**
 * Where shelves go between the bottom panel at `bottom` and the top panel at `top`, so
 * that no panel is more than 15 in above the one below it.
 */
function shelfHeights(bottom: Len, top: Len): Len[] {
  const rise = top - bottom;
  const shelves = Math.ceil(rise / MAX_SHELF_SPACING) - 1;
  const heights: Len[] = [];
  for (let i = 1; i <= shelves; i += 1) {
    heights.push(bottom + Math.floor((i * rise) / (shelves + 1)));
  }
  return heights;
}

/**
 * A frameless box: two sides with the bottom, back and optional top between them. With a
 * toe kick the box stands on a recessed plinth.
 */
function box(item: Item, features: { toeKick: boolean; top: boolean; shelves: boolean }): Part[] {
  const { width: W, height: H, depth: D } = item;
  const floor = features.toeKick ? TOE_KICK_HEIGHT : 0;
  const inner = { x: T, w: W - 2 * T };
  const parts = [
    carcass('side', { x: 0, y: floor, z: 0, w: T, h: H - floor, d: D }),
    carcass('side', { x: W - T, y: floor, z: 0, w: T, h: H - floor, d: D }),
    carcass('bottom', { ...inner, y: floor, z: T, h: T, d: D - T }),
    carcass('back', { ...inner, y: floor, z: 0, h: H - floor, d: T }),
  ];
  if (features.top) parts.push(carcass('top', { ...inner, y: H - T, z: T, h: T, d: D - T }));
  if (features.shelves) {
    for (const y of shelfHeights(floor, H - T)) {
      parts.push(carcass('shelf', { ...inner, y, z: T, h: T, d: D - T }));
    }
  }
  if (features.toeKick) {
    parts.push(
      carcass('toe-kick', { x: 0, y: 0, z: D - TOE_KICK_DEPTH - T, w: W, h: floor, d: T }),
    );
  }
  return parts;
}

function baseParts(item: Item, entry: CatalogEntry): Part[] {
  const parts = box(item, { toeKick: true, top: false, shelves: false });
  const bottom = TOE_KICK_HEIGHT + EDGE;
  const top = item.height - EDGE;

  const drawers = count(item, entry, 'drawers', 0);
  if (drawers > 0) {
    for (const { at, size } of spans(bottom, top, drawers)) {
      parts.push(drawerFront(item, at, at + size));
    }
    return parts;
  }

  let doorTop = top;
  if (option(item, entry, 'topDrawer') === true) {
    parts.push(drawerFront(item, top - TOP_DRAWER_FRONT_HEIGHT, top));
    doorTop = top - TOP_DRAWER_FRONT_HEIGHT - FRONT_REVEAL;
  }
  parts.push(...doorRow(item, bottom, doorTop, count(item, entry, 'doors', 1)));
  return parts;
}

function wallParts(item: Item, entry: CatalogEntry): Part[] {
  return [
    ...box(item, { toeKick: false, top: true, shelves: true }),
    ...doorRow(item, EDGE, item.height - EDGE, count(item, entry, 'doors', 1)),
  ];
}

function tallParts(item: Item, entry: CatalogEntry): Part[] {
  const bottom = TOE_KICK_HEIGHT + EDGE;
  const top = item.height - EDGE;

  const ovens = count(item, entry, 'ovens', 0);
  if (ovens > 0) {
    // From the floor up: a drawer, the ovens, then a pair of doors. One oven sits at
    // working height; two start lower to fit.
    const parts = box(item, { toeKick: true, top: true, shelves: false });
    const ovenBottom = TOE_KICK_HEIGHT + inches(ovens === 1 ? 24 : 9);
    parts.push(drawerFront(item, bottom, ovenBottom - EDGE));
    for (let i = 0; i < ovens; i += 1) {
      parts.push({
        role: 'body',
        box: {
          x: T,
          y: ovenBottom + i * OVEN_OPENING_HEIGHT + EDGE,
          z: T,
          w: item.width - 2 * T,
          h: OVEN_OPENING_HEIGHT - FRONT_REVEAL,
          d: item.depth - T,
        },
        finishSlot: 'appliance',
      });
    }
    parts.push(...doorRow(item, ovenBottom + ovens * OVEN_OPENING_HEIGHT + EDGE, top, 2));
    return parts;
  }

  const parts = box(item, { toeKick: true, top: true, shelves: true });
  const doors = count(item, entry, 'doors', 2);
  if (doors < 4) return [...parts, ...doorRow(item, bottom, top, doors)];
  // Two rows that split where the wall cabinets beside it start.
  const columns = Math.ceil(doors / 2);
  return [
    ...parts,
    ...doorRow(item, bottom, WALL_CABINET_ELEVATION - EDGE, columns),
    ...doorRow(item, WALL_CABINET_ELEVATION + EDGE, top, columns),
  ];
}

/** A base cabinet with one door over the end that is not hidden in the corner. */
function blindCornerParts(item: Item, entry: CatalogEntry): Part[] {
  const hidden = item.depth;
  const [x0, x1] =
    option(item, entry, 'blind') === 'right'
      ? [EDGE, item.width - hidden - EDGE]
      : [hidden + EDGE, item.width - EDGE];
  return [
    ...box(item, { toeKick: true, top: false, shelves: false }),
    front('door', {
      x: x0,
      y: TOE_KICK_HEIGHT + EDGE,
      z: item.depth,
      w: x1 - x0,
      h: item.height - TOE_KICK_HEIGHT - FRONT_REVEAL,
      d: T,
    }),
  ];
}

/**
 * An L-shaped base. Leg A runs along the item's own wall (the x axis), leg B along the
 * adjacent wall at its left end (the z axis). Each is as deep as a base cabinet, and each
 * has a door on the face that looks into the notch.
 */
function lCornerParts(item: Item): Part[] {
  const { width: W, height: H, depth: D } = item;
  const L = BASE_CABINET_DEPTH;
  const floor = TOE_KICK_HEIGHT;
  const h = H - floor;
  const kick = L - TOE_KICK_DEPTH - T;
  return [
    carcass('back', { x: 0, y: floor, z: 0, w: W, h, d: T }),
    carcass('back', { x: 0, y: floor, z: T, w: T, h, d: D - T }),
    carcass('side', { x: W - T, y: floor, z: T, w: T, h, d: L - T }),
    carcass('side', { x: T, y: floor, z: D - T, w: L - T, h, d: T }),
    carcass('bottom', { x: T, y: floor, z: T, w: W - 2 * T, h: T, d: L - T }),
    carcass('bottom', { x: T, y: floor, z: L, w: L - T, h: T, d: D - L - T }),
    carcass('toe-kick', { x: kick, y: 0, z: kick, w: W - kick, h: floor, d: T }),
    carcass('toe-kick', { x: kick, y: 0, z: kick + T, w: T, h: floor, d: D - kick - T }),
    front('door', { x: L, y: floor + EDGE, z: L, w: W - L - EDGE, h: h - FRONT_REVEAL, d: T }),
    front('door', {
      x: L,
      y: floor + EDGE,
      z: L + T + FRONT_REVEAL,
      w: T,
      h: h - FRONT_REVEAL,
      d: D - L - T - FRONT_REVEAL - EDGE,
    }),
  ];
}

/**
 * A wall cabinet with a 12 in deep leg on each wall and one door at 45 degrees between
 * the leg ends. The door and the fill piece of each shelf are the only rotated boxes;
 * their sizes are rounded down to whole sixteenths. Pieces may overlap inside the carcass.
 */
function diagonalCornerParts(item: Item): Part[] {
  const { width: W, height: H, depth: D } = item;
  // The door runs from (W, L) to (L, D), its thickness toward the corner. The legs stop
  // `cut` short of that line so they clear the back of the door.
  const L = WALL_CABINET_DEPTH;
  const cut = Math.ceil(T * Math.SQRT2);
  const leg = L - cut;
  const rotation = 135;
  const slab = (role: PartRole, y: Len): Part[] => [
    carcass(role, { x: T, y, z: T, w: W - 2 * T, h: T, d: leg - T }),
    carcass(role, { x: T, y, z: leg, w: leg - T, h: T, d: D - T - leg }),
    {
      ...carcass(role, {
        x: W,
        y,
        z: leg,
        w: Math.floor((W - leg) * Math.SQRT2),
        h: T,
        d: Math.floor((W - leg) / Math.SQRT2),
      }),
      rotation,
    },
  ];
  return [
    carcass('back', { x: 0, y: 0, z: 0, w: W, h: H, d: T }),
    carcass('back', { x: 0, y: 0, z: T, w: T, h: H, d: D - T }),
    carcass('side', { x: W - T, y: 0, z: T, w: T, h: H, d: leg - T }),
    carcass('side', { x: T, y: 0, z: D - T, w: leg - T, h: H, d: T }),
    ...slab('bottom', 0),
    ...slab('top', H - T),
    ...shelfHeights(0, H - T).flatMap((y) => slab('shelf', y)),
    {
      ...front('door', {
        x: W,
        y: EDGE,
        z: L,
        w: Math.floor((W - L) * Math.SQRT2),
        h: H - FRONT_REVEAL,
        d: T,
      }),
      rotation,
    },
  ];
}

/** The whole item as one box. */
const solid = (item: Item, role: PartRole, finishSlot: Part['finishSlot']): Part[] => [
  { role, box: { x: 0, y: 0, z: 0, w: item.width, h: item.height, d: item.depth }, finishSlot },
];

/**
 * The boxes that make up an item, for the renderers and the bill of materials. Every box
 * is inside `[0, width] x [0, height] x [0, depth]`, except that doors and drawer fronts
 * project 3/4 in past the front.
 *
 * Deterministic: the output depends only on the item and its catalog entry. Meant for an
 * item that passes `checkItemAgainstCatalog`; an item with no entry has no parts.
 */
export function generateParts(item: Item, catalog: Catalog): Part[] {
  const entry = getEntry(catalog, item.catalogId);
  if (!entry) return [];
  switch (entry.kind) {
    case 'base':
      return baseParts(item, entry);
    case 'wall':
      return wallParts(item, entry);
    case 'tall':
      return tallParts(item, entry);
    case 'corner':
      if (entry.corner === 'l') return lCornerParts(item);
      if (entry.corner === 'diagonal') return diagonalCornerParts(item);
      return blindCornerParts(item, entry);
    case 'appliance':
      return solid(item, 'body', 'appliance');
    case 'filler':
      return solid(item, 'filler', 'front');
    case 'panel':
      return solid(item, 'panel', 'front');
  }
}
