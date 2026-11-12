import type { Wall } from '../document/index.js';
import { EPS, type Footprint, type Pt } from './plan.js';

// Oriented-rectangle helpers, for items on different walls and free-placed items. Checks
// along a single wall use exact integer intervals instead (see intervals.ts).

/**
 * Whether two oriented rectangles overlap, by the separating-axis test. They must overlap
 * by more than `EPS` on every axis, so touching edges do not count.
 */
export function rectsOverlap(a: Footprint, b: Footprint): boolean {
  for (const rect of [a, b]) {
    // A rectangle has two edge directions: along its back and along its right side.
    for (let i = 0; i < 2; i += 1) {
      const p = rect[i]!;
      const q = rect[i + 1]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const ax = (q.x - p.x) / length;
      const ay = (q.y - p.y) / length;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (let k = 0; k < 4; k += 1) {
        const pa = a[k]!.x * ax + a[k]!.y * ay;
        const pb = b[k]!.x * ax + b[k]!.y * ay;
        minA = Math.min(minA, pa);
        maxA = Math.max(maxA, pa);
        minB = Math.min(minB, pb);
        maxB = Math.max(maxB, pb);
      }
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= EPS) return false;
    }
  }
  return true;
}

/** Distance from a point to the segment from `a` to `b`. */
export function distancePointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to the wall's interior face. */
export const distancePointToWall = (p: Pt, wall: Pick<Wall, 'start' | 'end'>): number =>
  distancePointToSegment(p, wall.start, wall.end);

/**
 * Whether the segment from `a` to `b` passes through the inside of the rectangle. Running
 * along an edge, or ending on one, does not count.
 */
export function segmentCrossesRect(rect: Footprint, a: Pt, b: Pt): boolean {
  const [origin, right, , left] = rect;
  // Clip the segment, in the rectangle's own axes, to the rectangle shrunk by EPS.
  let enter = 0;
  let leave = 1;
  for (const corner of [right, left]) {
    const size = Math.hypot(corner.x - origin.x, corner.y - origin.y);
    const ux = (corner.x - origin.x) / size;
    const uy = (corner.y - origin.y) / size;
    const from = (a.x - origin.x) * ux + (a.y - origin.y) * uy;
    const delta = (b.x - a.x) * ux + (b.y - a.y) * uy;
    if (Math.abs(delta) < 1e-9) {
      if (from <= EPS || from >= size - EPS) return false;
    } else {
      const t1 = (EPS - from) / delta;
      const t2 = (size - EPS - from) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
    }
  }
  return enter < leave;
}

/** Distance between a rectangle and a segment; 0 if the segment crosses the rectangle. */
export function distanceRectToSegment(rect: Footprint, a: Pt, b: Pt): number {
  if (segmentCrossesRect(rect, a, b)) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const p = rect[i]!;
    const q = rect[(i + 1) % 4]!;
    best = Math.min(
      best,
      distancePointToSegment(p, a, b),
      distancePointToSegment(a, p, q),
      distancePointToSegment(b, p, q),
    );
  }
  return best;
}

/** Distance between two oriented rectangles; 0 if they overlap or touch. */
export function distanceRectToRect(a: Footprint, b: Footprint): number {
  if (rectsOverlap(a, b)) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      best = Math.min(
        best,
        distancePointToSegment(a[i]!, b[j]!, b[(j + 1) % 4]!),
        distancePointToSegment(b[i]!, a[j]!, a[(j + 1) % 4]!),
      );
    }
  }
  return best;
}

/**
 * Whether the walls form a closed room: at least three, each ending where the next one
 * starts, and the last ending where the first starts.
 */
export function isClosedLoop(walls: readonly Pick<Wall, 'start' | 'end'>[]): boolean {
  return (
    walls.length >= 3 &&
    walls.every((wall, i) => {
      const next = walls[(i + 1) % walls.length]!;
      return wall.end.x === next.start.x && wall.end.y === next.start.y;
    })
  );
}

/** Whether the point is inside the polygon, by ray casting. */
export function pointInPolygon(p: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
