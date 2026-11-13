import {
  distanceRectToRect,
  distanceRectToSegment,
  EPS,
  footprintInWallFrame,
} from '../../geometry/index.js';
import { formatLength } from '../../units/index.js';
import { type PlacedItem, the, verticalOverlap } from '../context.js';
import { defineRule, type Finding } from '../types.js';

/** Touching is no aisle at all, as with a peninsula against a wall. */
const tooNarrow = (distance: number, minAisle: number): boolean =>
  distance > EPS && distance < minAisle - EPS;

/** On two walls that face each other, with some of one item straight across from the other. */
function facing(a: PlacedItem, b: PlacedItem): boolean {
  const wallA = a.wall!;
  const wallB = b.wall!;
  if (wallA.normal.x * wallB.normal.x + wallA.normal.y * wallB.normal.y > -0.5) return false;
  const [from, to] = footprintInWallFrame(wallA.wall, b.footprint).along;
  return from < a.end - EPS && to > a.start + EPS;
}

/**
 * Less than 36 in to walk through: between items on facing walls, or between a
 * free-standing item such as an island and a wall or another item.
 */
export const clearanceAisle = defineRule('clearance.aisle', 'warning', (ctx) => {
  const findings: Finding[] = [];
  const { minAisle, recommendedAisle } = ctx.config.thresholds;
  const advice = `An aisle needs at least ${formatLength(minAisle)}; ${formatLength(recommendedAisle)} is recommended.`;
  for (const placed of ctx.items) {
    if (placed.wall) continue;
    for (const wall of ctx.walls) {
      const distance = distanceRectToSegment(placed.footprint, wall.wall.start, wall.wall.end);
      if (!tooNarrow(distance, minAisle)) continue;
      findings.push({
        itemIds: [placed.item.id, wall.wall.id],
        message: `Only ${formatLength(distance)} between ${the(placed.label)} and wall ${wall.label}. ${advice}`,
      });
    }
  }
  for (const [a, b] of ctx.pairsWithin(minAisle)) {
    if (!verticalOverlap(a, b) || (a.wall && b.wall && !facing(a, b))) continue;
    const distance = distanceRectToRect(a.footprint, b.footprint);
    if (!tooNarrow(distance, minAisle)) continue;
    findings.push({
      itemIds: [a.item.id, b.item.id],
      message: `Only ${formatLength(distance)} between ${the(a.label)} and ${the(b.label)}. ${advice}`,
    });
  }
  return findings;
});
