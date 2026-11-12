import {
  type Catalog,
  type CatalogEntry,
  type Command,
  defaultItemFor,
  type DesignDocument,
  freeGaps,
  getEntry,
  type Id,
  type Item,
  type Len,
  type Placement,
  STEP,
  wallDirection,
  wallLength,
} from '@ezd/core';

import type { NewId } from './ids';
import { findTarget, wallOf } from './tools/select';

// Builds the command for each edit the editor offers. Nothing here changes a document:
// the store executes what these return.

/** One command for several: the command itself, or a `batch` so it is one undo step. */
export function asOne(commands: Command[], label: string): Command | null {
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0]! : { type: 'batch', commands, label };
}

const samePlacement = (a: Placement, b: Placement): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** L-shaped and diagonal corner cabinets are square: their depth follows their width. */
const isSquare = (catalog: Catalog, item: Item): boolean => {
  const corner = getEntry(catalog, item.catalogId)?.corner;
  return corner === 'l' || corner === 'diagonal';
};

/**
 * Sets an item's width, moving it too when its left edge moved. Null if nothing changes.
 */
export function resizeCommand(
  catalog: Catalog,
  item: Item,
  width: Len,
  placement: Placement = item.placement,
): Command | null {
  if (width === item.width) return null;
  const resize: Command = {
    type: 'item.resize',
    id: item.id,
    width,
    ...(isSquare(catalog, item) && { depth: width }),
  };
  if (samePlacement(placement, item.placement)) return resize;
  return {
    type: 'batch',
    commands: [resize, { type: 'item.move', id: item.id, placement }],
    label: 'Resize',
  };
}

/** A new item of the entry at the given width, not yet placed anywhere. */
export function newItem(entry: CatalogEntry, width: Len, id: Id): Item {
  const item = defaultItemFor(entry, id);
  const square = entry.corner === 'l' || entry.corner === 'diagonal';
  return { ...item, width, ...(square && { depth: width }) };
}

/**
 * The first free stretch of the wall that fits the item in its height band, at or after
 * `from` if there is one and anywhere on the wall otherwise.
 */
function freeOffset(doc: DesignDocument, wallId: Id, item: Item, from: Len): Len | null {
  const gaps = freeGaps(doc, wallId, [item.elevation, item.elevation + item.height]);
  for (const [start, end] of gaps) {
    const offset = Math.max(start, from);
    if (end - offset >= item.width) return offset;
  }
  const fits = gaps.find(([start, end]) => end - start >= item.width);
  return fits ? fits[0] : null;
}

/** Where a new item goes when it is added without dragging: the first wall with room. */
export function freeSpot(doc: DesignDocument, catalog: Catalog, item: Item): Placement | null {
  const allowed = getEntry(catalog, item.catalogId)?.placement ?? ['wall', 'free'];
  if (allowed.includes('wall')) {
    for (const wall of doc.room.walls) {
      const offset = freeOffset(doc, wall.id, item, 0);
      if (offset !== null) return { type: 'wall', wallId: wall.id, offset };
    }
  }
  return allowed.includes('free') ? { type: 'free', x: 0, y: 0, rotation: 0 } : null;
}

/**
 * Copies an item to the next free position on its wall. A free-standing item is copied
 * beside itself. Null when the wall has no room for another one.
 */
export function duplicateCommand(doc: DesignDocument, item: Item, newId: NewId): Command | null {
  const { placement } = item;
  let next: Placement;
  if (placement.type === 'wall') {
    const offset = freeOffset(doc, placement.wallId, item, placement.offset + item.width);
    if (offset === null) return null;
    next = { ...placement, offset };
  } else {
    const angle = (placement.rotation * Math.PI) / 180;
    next = {
      ...placement,
      x: Math.round(placement.x + Math.cos(angle) * item.width),
      y: Math.round(placement.y + Math.sin(angle) * item.width),
    };
  }
  return { type: 'item.add', item: { ...item, id: newId('item'), placement: next } };
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export const isArrowKey = (key: string): key is ArrowKey =>
  key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

const ARROW_VECTOR: Record<ArrowKey, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Moves an item 3 in with an arrow key, or 1/16 in when `fine` is set and the item is a
 * filler. On a wall the item moves along the wall, the way the arrow points on screen: in
 * the plan that depends on which way the wall runs, and in an elevation left is toward
 * the wall start. Null when the key does not move this item.
 */
export function nudgeCommand(
  doc: DesignDocument,
  item: Item,
  key: ArrowKey,
  fine: boolean,
  view: 'plan' | 'elevation',
): Command | null {
  const step = fine && item.kind === 'filler' ? 1 : STEP;
  const arrow = ARROW_VECTOR[key];
  const { placement } = item;

  if (placement.type === 'free') {
    if (view === 'elevation') return null;
    return {
      type: 'item.move',
      id: item.id,
      placement: {
        ...placement,
        x: placement.x + arrow.x * step,
        y: placement.y + arrow.y * step,
      },
    };
  }

  const wall = wallOf(doc, placement.wallId);
  if (!wall) return null;
  let sign: number;
  if (view === 'elevation') {
    sign = arrow.x;
  } else {
    const direction = wallDirection(wall);
    const horizontal = Math.abs(direction.x) >= Math.abs(direction.y);
    sign = horizontal ? arrow.x * Math.sign(direction.x) : arrow.y * Math.sign(direction.y);
  }
  if (sign === 0) return null;
  const max = Math.max(0, Math.round(wallLength(wall)) - item.width);
  const offset = Math.min(max, Math.max(0, placement.offset + sign * step));
  if (offset === placement.offset) return null;
  return { type: 'item.move', id: item.id, placement: { ...placement, offset } };
}

/** Removes everything selected, as one undo step. */
export function removeCommand(doc: DesignDocument, ids: readonly Id[]): Command | null {
  const commands = ids.flatMap((id): Command[] => {
    const target = findTarget(doc, id);
    return target ? [{ type: `${target.kind}.remove`, id }] : [];
  });
  return asOne(commands, 'Delete');
}
