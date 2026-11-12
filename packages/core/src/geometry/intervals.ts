import type { DesignDocument, Id, Wall } from '../document/index.js';
import type { Len } from '../units/index.js';
import {
  EPS,
  type Footprint,
  itemFootprint,
  itemVerticalRange,
  type Pt,
  wallDirection,
  wallLength,
  wallNormal,
} from './plan.js';

// Checks along a single wall use these intervals and exact integer math.

export type WallInterval = {
  /** The item or opening. */
  id: Id;
  /**
   * `adjacent` is an item on another wall whose footprint reaches this wall's face, as a
   * cabinet at the end of one wall does to the wall it meets in the corner.
   */
  kind: 'item' | 'opening' | 'adjacent';
  /** From the wall start, along the wall. */
  start: Len;
  end: Len;
  /** Above the floor. */
  bottom: Len;
  top: Len;
};

/** Where a point is relative to a wall: `along` it from its start, and `into` the room. */
export function pointInWallFrame(wall: Pick<Wall, 'start' | 'end'>, p: Pt) {
  const d = wallDirection(wall);
  const n = wallNormal(wall);
  const x = p.x - wall.start.x;
  const y = p.y - wall.start.y;
  return { along: x * d.x + y * d.y, into: x * n.x + y * n.y };
}

/** The extent of a footprint along a wall and into the room, each as `[min, max]`. */
export function footprintInWallFrame(
  wall: Pick<Wall, 'start' | 'end'>,
  footprint: Footprint,
): { along: [number, number]; into: [number, number] } {
  const points = footprint.map((p) => pointInWallFrame(wall, p));
  const along = points.map((p) => p.along);
  const into = points.map((p) => p.into);
  return {
    along: [Math.min(...along), Math.max(...along)],
    into: [Math.min(...into), Math.max(...into)],
  };
}

/** Whether two `[bottom, top]` or `[start, end]` ranges overlap. Touching does not count. */
export const rangesOverlap = (a: readonly [Len, Len], b: readonly [Len, Len]): boolean =>
  a[0] < b[1] && b[0] < a[1];

/**
 * The stretch of a wall that a footprint on another wall takes up, or null if it does not
 * reach this wall's face from inside the room.
 */
export function reachAlongWall(
  wall: Pick<Wall, 'start' | 'end'>,
  length: number,
  footprint: Footprint,
): [Len, Len] | null {
  const { along, into } = footprintInWallFrame(wall, footprint);
  const start = Math.max(0, along[0]);
  const end = Math.min(length, along[1]);
  if (into[0] > EPS || into[1] <= EPS || end - start <= EPS) return null;
  return [Math.round(start), Math.round(end)];
}

/**
 * What occupies a wall: its openings, the items placed on it and the items on other walls
 * that reach it. Sorted by start, then end, then id.
 */
export function wallIntervals(doc: DesignDocument, wallId: Id): WallInterval[] {
  const wall = doc.room.walls.find((candidate) => candidate.id === wallId);
  if (!wall) return [];
  const length = wallLength(wall);
  const intervals: WallInterval[] = [];
  for (const opening of doc.room.openings) {
    if (opening.wallId !== wallId) continue;
    intervals.push({
      id: opening.id,
      kind: 'opening',
      start: opening.offset,
      end: opening.offset + opening.width,
      bottom: opening.sillHeight,
      top: opening.sillHeight + opening.height,
    });
  }
  for (const item of doc.items) {
    const { placement } = item;
    if (placement.type !== 'wall') continue;
    const [bottom, top] = itemVerticalRange(item);
    if (placement.wallId === wallId) {
      const start = placement.offset;
      intervals.push({ id: item.id, kind: 'item', start, end: start + item.width, bottom, top });
      continue;
    }
    const footprint = itemFootprint(doc, item);
    const reach = footprint && reachAlongWall(wall, length, footprint);
    if (reach) {
      intervals.push({
        id: item.id,
        kind: 'adjacent',
        start: reach[0],
        end: reach[1],
        bottom,
        top,
      });
    }
  }
  return intervals.sort((a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1));
}

/**
 * The free stretches of a wall, as `[start, end]`, for the height band `[bottom, top]`:
 * what no opening or item in that band occupies.
 */
export function freeGaps(
  doc: DesignDocument,
  wallId: Id,
  verticalRange: readonly [Len, Len],
): [Len, Len][] {
  const wall = doc.room.walls.find((candidate) => candidate.id === wallId);
  if (!wall) return [];
  const length = Math.round(wallLength(wall));
  const gaps: [Len, Len][] = [];
  let cursor = 0;
  for (const interval of wallIntervals(doc, wallId)) {
    if (!rangesOverlap([interval.bottom, interval.top], verticalRange)) continue;
    if (interval.start > cursor) gaps.push([cursor, Math.min(interval.start, length)]);
    cursor = Math.max(cursor, interval.end);
    if (cursor >= length) break;
  }
  if (cursor < length) gaps.push([cursor, length]);
  return gaps;
}
