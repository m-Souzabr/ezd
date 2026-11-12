import type { Command } from '../../commands/index.js';
import { EPS, footprintInWallFrame } from '../../geometry/index.js';
import { meetInCorner, type PlacedItem, the } from '../context.js';
import { moveAlongWall } from '../helpers.js';
import { defineRule } from '../types.js';

/**
 * Moves one item along its wall until it is clear of the other: the item after the corner
 * forward by the depth of the one before it, or the one before it back. A corner cabinet
 * stays where it is if the other item can move.
 */
function clearCorner(before: PlacedItem, after: PlacedItem): Command[] | undefined {
  const forward = Math.ceil(
    footprintInWallFrame(after.wall!.wall, before.footprint).along[1] - EPS,
  );
  const back =
    Math.floor(footprintInWallFrame(before.wall!.wall, after.footprint).along[0] + EPS) -
    before.item.width;
  const moves = [
    ...(forward + after.item.width <= after.wall!.length ? [moveAlongWall(after, forward)] : []),
    ...(back >= 0 ? [moveAlongWall(before, back)] : []),
  ];
  const move = after.item.kind === 'corner' ? moves.at(-1) : moves[0];
  return move && [move];
}

/** Items on two walls that meet, overlapping in the corner. */
export const cornerConflict = defineRule('corner.conflict', 'error', (ctx) =>
  ctx
    .overlaps()
    .filter(([a, b]) => meetInCorner(a, b))
    .map(([a, b]) => {
      // `before` is on the wall that ends at the corner, `after` on the one that starts there.
      const [before, after] = a.wall!.next === b.wall ? [a, b] : [b, a];
      const fix = clearCorner(before, after);
      return {
        itemIds: [a.item.id, b.item.id],
        message: `${before.label} and ${the(after.label)} overlap in the corner where walls ${before.wall!.label} and ${after.wall!.label} meet.`,
        ...(fix && { fix }),
      };
    }),
);
