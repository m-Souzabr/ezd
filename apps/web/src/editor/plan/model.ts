import {
  type DesignDocument,
  type Footprint,
  formatLength,
  type Item,
  itemFootprint,
  type Opening,
  pointOnWall,
  type Pt,
  rangesOverlap,
  type Wall,
  wallDirection,
  wallIntervals,
  wallLabel,
  wallLength,
  wallNormal,
} from '@ezd/core';

import { wallOf } from '../tools/select';

// What the plan view draws, worked out from the document. Pure, so it is tested without a
// canvas. Points are plan points in sixteenths of an inch.

const samePoint = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/**
 * Where the outer faces of two walls meet: `a` ends at `corner` and `b` starts there.
 * Null when the walls run in a straight line, which has no corner to fill.
 */
function outerCorner(corner: Pt, a: Wall, b: Wall): Pt | null {
  const d1 = wallDirection(a);
  const d2 = wallDirection(b);
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-6) return null;
  const n1 = wallNormal(a);
  const n2 = wallNormal(b);
  const p1 = { x: corner.x - n1.x * a.thickness, y: corner.y - n1.y * a.thickness };
  const p2 = { x: corner.x - n2.x * b.thickness, y: corner.y - n2.y * b.thickness };
  const s = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross;
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y };
}

/**
 * The wall's thickness as a polygon, outside its interior face. Where the next wall
 * starts at its end, or the one before ends at its start, the outer edge runs to where
 * the two outer faces meet, so the corner is mitred whichever way it turns.
 */
export function wallPolygon(doc: DesignDocument, wall: Wall): Pt[] {
  const normal = wallNormal(wall);
  const outside = (p: Pt): Pt => ({
    x: p.x - normal.x * wall.thickness,
    y: p.y - normal.y * wall.thickness,
  });
  const others = doc.room.walls.filter((other) => other.id !== wall.id);
  const next = others.find((other) => samePoint(other.start, wall.end));
  const before = others.find((other) => samePoint(other.end, wall.start));
  return [
    wall.start,
    wall.end,
    (next && outerCorner(wall.end, wall, next)) ?? outside(wall.end),
    (before && outerCorner(wall.start, before, wall)) ?? outside(wall.start),
  ];
}

/** A line to dimension: its ends, the way to push it clear of what it measures, its text. */
export type Dimension = {
  from: Pt;
  to: Pt;
  /** Unit vector. The view moves the line this way by a fixed number of pixels. */
  away: Pt;
  text: string;
  kind: 'wall' | 'width' | 'gap';
};

/** Every wall's length, drawn outside the wall: `A 120"`. */
export function wallDimensions(doc: DesignDocument): Dimension[] {
  return doc.room.walls.map((wall) => {
    const normal = wallNormal(wall);
    const out = { x: -normal.x || 0, y: -normal.y || 0 };
    const shift = (p: Pt): Pt => ({
      x: p.x + out.x * wall.thickness,
      y: p.y + out.y * wall.thickness,
    });
    return {
      from: shift(wall.start),
      to: shift(wall.end),
      away: out,
      text: `${wallLabel(doc, wall.id)}  ${formatLength(wallLength(wall))}`,
      kind: 'wall',
    };
  });
}

/**
 * For the selected item: its width, and the gap on each side to the nearest neighbour in
 * its height band, opening or wall end. A free-standing item has only its width.
 */
export function itemDimensions(doc: DesignDocument, item: Item): Dimension[] {
  const footprint = itemFootprint(doc, item);
  if (!footprint) return [];
  const [backLeft, , frontRight, frontLeft] = footprint;
  const depth = Math.hypot(frontLeft.x - backLeft.x, frontLeft.y - backLeft.y) || 1;
  const away = { x: (frontLeft.x - backLeft.x) / depth, y: (frontLeft.y - backLeft.y) / depth };
  const width: Dimension = {
    from: frontLeft,
    to: frontRight,
    away,
    text: formatLength(item.width),
    kind: 'width',
  };
  const { placement } = item;
  const wall = placement.type === 'wall' ? wallOf(doc, placement.wallId) : undefined;
  if (placement.type !== 'wall' || !wall) return [width];

  const start = placement.offset;
  const end = start + item.width;
  const length = Math.round(wallLength(wall));
  const band = [item.elevation, item.elevation + item.height] as const;
  let left = 0;
  let right = length;
  for (const interval of wallIntervals(doc, wall.id)) {
    if (interval.id === item.id) continue;
    const inBand =
      interval.kind === 'opening' || rangesOverlap([interval.bottom, interval.top], band);
    if (!inBand) continue;
    if (interval.end <= start) left = Math.max(left, interval.end);
    if (interval.start >= end) right = Math.min(right, interval.start);
  }

  const at = (offset: number): Pt => {
    const p = pointOnWall(wall, offset);
    return { x: p.x + away.x * item.depth, y: p.y + away.y * item.depth };
  };
  const gap = (from: number, to: number): Dimension[] =>
    to > from
      ? [{ from: at(from), to: at(to), away, text: formatLength(to - from), kind: 'gap' }]
      : [];
  return [...gap(left, start), width, ...gap(end, right)];
}

/** How a door or window is drawn in the plan. */
export type OpeningSymbol = {
  /** The stretch of wall the opening cuts out, through the wall's thickness. */
  gap: Footprint;
  /** A door's leaf when open, and the arc its latch edge sweeps. */
  swing?: { hinge: Pt; open: Pt; closed: Pt; radius: number };
};

export function openingSymbol(wall: Wall, opening: Opening): OpeningSymbol {
  const normal = wallNormal(wall);
  const a = pointOnWall(wall, opening.offset);
  const b = pointOnWall(wall, opening.offset + opening.width);
  const t = wall.thickness;
  const gap: Footprint = [
    a,
    b,
    { x: b.x - normal.x * t, y: b.y - normal.y * t },
    { x: a.x - normal.x * t, y: a.y - normal.y * t },
  ];
  if (opening.kind !== 'door' || !opening.swing) return { gap };

  // `left` hinges at the opening's start, which is on the left seen from inside the room.
  const left = opening.swing.endsWith('left');
  const side = opening.swing.startsWith('in') ? 1 : -1;
  const hinge = left ? a : b;
  const closed = left ? b : a;
  const radius = opening.width;
  // Swinging out, the leaf turns about the outer face of the wall.
  const pivot = side === 1 ? hinge : { x: hinge.x - normal.x * t, y: hinge.y - normal.y * t };
  const latch = side === 1 ? closed : { x: closed.x - normal.x * t, y: closed.y - normal.y * t };
  return {
    gap,
    swing: {
      hinge: pivot,
      closed: latch,
      open: { x: pivot.x + normal.x * radius * side, y: pivot.y + normal.y * radius * side },
      radius,
    },
  };
}
