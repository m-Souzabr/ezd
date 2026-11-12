import { distancePointToSegment, EPS, pointOnWall, type Pt } from '../../geometry/index.js';
import { openingLabel } from '../context.js';
import { defineRule, type Finding } from '../types.js';

const ORIGIN: Pt = { x: 0, y: 0 };

/** The part of a polygon where the coordinate on `axis` is positive. */
function clipPositive(points: Pt[], axis: 'x' | 'y'): Pt[] {
  const out: Pt[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    if (p[axis] > 0) out.push(p);
    if (p[axis] > 0 !== q[axis] > 0) {
      const t = p[axis] / (p[axis] - q[axis]);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  });
  return out;
}

/**
 * An item inside the quarter circle a door sweeps as it opens into the room. `in-left` is
 * hinged at the opening's start, which is on the left seen from inside the room, and
 * `in-right` at its end. A door that swings out sweeps nothing in the room. An item
 * standing in the doorway itself is `item.blocks-door` instead.
 */
export const clearanceDoorSwing = defineRule('clearance.door-swing', 'warning', (ctx) => {
  const findings: Finding[] = [];
  for (const wall of ctx.walls) {
    for (const door of wall.openings) {
      if (!door.swing?.startsWith('in-')) continue;
      const left = door.swing === 'in-left';
      const doorEnd = door.offset + door.width;
      const hinge = pointOnWall(wall.wall, left ? door.offset : doorEnd);
      // Axes from the hinge: toward the latch along the wall, and into the room.
      const sign = left ? 1 : -1;
      const radius = door.width;
      for (const placed of ctx.items) {
        if (
          placed.bottom >= door.height ||
          placed.minX > hinge.x + radius ||
          placed.maxX < hinge.x - radius ||
          placed.minY > hinge.y + radius ||
          placed.maxY < hinge.y - radius ||
          (placed.wall === wall && placed.start < doorEnd && door.offset < placed.end)
        ) {
          continue;
        }
        // Shifted by EPS, so an item that only touches the swept quarter stays clear of it.
        const local = placed.footprint.map((p) => ({
          x: ((p.x - hinge.x) * wall.direction.x + (p.y - hinge.y) * wall.direction.y) * sign - EPS,
          y: (p.x - hinge.x) * wall.normal.x + (p.y - hinge.y) * wall.normal.y - EPS,
        }));
        const swept = clipPositive(clipPositive(local, 'x'), 'y');
        const nearest = Math.min(
          ...swept.map((p, i) => distancePointToSegment(ORIGIN, p, swept[(i + 1) % swept.length]!)),
        );
        if (nearest < radius - 2 * EPS) {
          findings.push({
            itemIds: [placed.item.id, door.id],
            message: `${placed.label} is in the swing of ${openingLabel(door, wall)}.`,
          });
        }
      }
    }
  }
  return findings;
});
