import {
  allowedWidths,
  type Catalog,
  type Countertop,
  type DesignDocument,
  type Footprint,
  getEntry,
  type Id,
  type Item,
  itemFootprint,
  type Opening,
  pointInPolygon,
  pointInWallFrame,
  pointOnWall,
  type Pt,
  type Wall,
  wallLength,
  wallNormal,
} from '@ezd/core';

// The select tool: what is under the pointer in the plan, the resize handles of the
// selected item, and the order Tab steps through the items.

export type Target =
  | { kind: 'item'; id: Id; item: Item }
  | { kind: 'countertop'; id: Id; countertop: Countertop }
  | { kind: 'opening'; id: Id; opening: Opening }
  | { kind: 'wall'; id: Id; wall: Wall };

/** The entity with the given id, whatever it is. */
export function findTarget(doc: DesignDocument, id: Id): Target | null {
  const item = doc.items.find((candidate) => candidate.id === id);
  if (item) return { kind: 'item', id, item };
  const countertop = doc.countertops.find((candidate) => candidate.id === id);
  if (countertop) return { kind: 'countertop', id, countertop };
  const opening = doc.room.openings.find((candidate) => candidate.id === id);
  if (opening) return { kind: 'opening', id, opening };
  const wall = doc.room.walls.find((candidate) => candidate.id === id);
  if (wall) return { kind: 'wall', id, wall };
  return null;
}

export const wallOf = (doc: DesignDocument, wallId: Id): Wall | undefined =>
  doc.room.walls.find((wall) => wall.id === wallId);

/** The rectangle in plan of a stretch of wall, from its face `depth` into the room. */
export function wallRect(wall: Wall, start: number, end: number, depth: number): Footprint {
  const normal = wallNormal(wall);
  const a = pointOnWall(wall, start);
  const b = pointOnWall(wall, end);
  return [
    a,
    b,
    { x: b.x + normal.x * depth, y: b.y + normal.y * depth },
    { x: a.x + normal.x * depth, y: a.y + normal.y * depth },
  ];
}

export function countertopFootprint(doc: DesignDocument, countertop: Countertop): Footprint | null {
  const wall = wallOf(doc, countertop.wallId);
  return wall
    ? wallRect(wall, countertop.startOffset, countertop.endOffset, countertop.depth)
    : null;
}

/** Whether `p` is on the wall's thickness between `start` and `end`, within `tolerance`. */
function onWallBand(wall: Wall, start: number, end: number, p: Pt, tolerance: number): boolean {
  const { along, into } = pointInWallFrame(wall, p);
  return along >= start && along <= end && into <= tolerance && into >= -wall.thickness - tolerance;
}

/**
 * What a click at `p` selects: the highest item there, else a countertop, an opening or a
 * wall. Wall cabinets are drawn over base cabinets, so they are hit first.
 */
export function hitTest(doc: DesignDocument, p: Pt, tolerance: number): Target | null {
  const items = doc.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.elevation - a.item.elevation || b.index - a.index);
  for (const { item } of items) {
    const footprint = itemFootprint(doc, item);
    if (footprint && pointInPolygon(p, footprint)) return { kind: 'item', id: item.id, item };
  }
  for (const countertop of doc.countertops) {
    const footprint = countertopFootprint(doc, countertop);
    if (footprint && pointInPolygon(p, footprint)) {
      return { kind: 'countertop', id: countertop.id, countertop };
    }
  }
  for (const opening of doc.room.openings) {
    const wall = wallOf(doc, opening.wallId);
    if (wall && onWallBand(wall, opening.offset, opening.offset + opening.width, p, tolerance)) {
      return { kind: 'opening', id: opening.id, opening };
    }
  }
  for (const wall of doc.room.walls) {
    if (onWallBand(wall, 0, wallLength(wall), p, tolerance)) {
      return { kind: 'wall', id: wall.id, wall };
    }
  }
  return null;
}

/** The wall whose thickness is under `p`, and how far along it. */
export function wallAt(
  doc: DesignDocument,
  p: Pt,
  tolerance: number,
): { wall: Wall; along: number } | null {
  for (const wall of doc.room.walls) {
    if (onWallBand(wall, 0, wallLength(wall), p, tolerance)) {
      return { wall, along: pointInWallFrame(wall, p).along };
    }
  }
  return null;
}

const middle = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Whether dragging a side of the item can change its width. */
export function isResizable(item: Item, catalog: Catalog): boolean {
  const entry = getEntry(catalog, item.catalogId);
  return !entry || allowedWidths(entry).length > 1;
}

/** The middle of the item's left and right sides, where its resize handles go. */
export function resizeHandles(doc: DesignDocument, item: Item): { left: Pt; right: Pt } | null {
  const footprint = itemFootprint(doc, item);
  if (!footprint) return null;
  const [backLeft, backRight, frontRight, frontLeft] = footprint;
  return { left: middle(backLeft, frontLeft), right: middle(backRight, frontRight) };
}

/** The resize handle of the item within `tolerance` of `p`. */
export function handleAt(
  doc: DesignDocument,
  item: Item,
  p: Pt,
  tolerance: number,
): 'left' | 'right' | null {
  const handles = resizeHandles(doc, item);
  if (!handles) return null;
  const near = (handle: Pt) => Math.hypot(handle.x - p.x, handle.y - p.y) <= tolerance;
  if (near(handles.right)) return 'right';
  if (near(handles.left)) return 'left';
  return null;
}

/**
 * The items in the order Tab visits them: wall by wall in document order, along each wall
 * from its start, then the free-standing items.
 */
export function tabOrder(doc: DesignDocument): Id[] {
  const wallIndex = new Map(doc.room.walls.map((wall, index) => [wall.id, index]));
  const key = (item: Item): [number, number] =>
    item.placement.type === 'wall'
      ? [wallIndex.get(item.placement.wallId) ?? 0, item.placement.offset]
      : [doc.room.walls.length, 0];
  return doc.items
    .map((item, index) => ({ id: item.id, key: key(item), elevation: item.elevation, index }))
    .sort(
      (a, b) =>
        a.key[0] - b.key[0] ||
        a.key[1] - b.key[1] ||
        a.elevation - b.elevation ||
        a.index - b.index,
    )
    .map((entry) => entry.id);
}

/** The id Tab moves to from the current selection, or null when it leaves the canvas. */
export function nextInTabOrder(
  doc: DesignDocument,
  current: Id | undefined,
  back: boolean,
): Id | null {
  const order = tabOrder(doc);
  const at = current === undefined ? -1 : order.indexOf(current);
  if (at === -1) return (back ? order.at(-1) : order[0]) ?? null;
  return order[at + (back ? -1 : 1)] ?? null;
}
