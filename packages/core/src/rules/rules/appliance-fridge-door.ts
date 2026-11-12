import { formatLength, type Len } from '../../units/index.js';
import type { WallInfo } from '../context.js';
import { FRIDGE_HINGE_CLEARANCE, FRIDGE_ID } from '../constants.js';
import { defineRule } from '../types.js';

/**
 * A refrigerator on a wall, less than 3 in from the side wall in the corner on its hinge
 * side, so its door cannot open fully. The hinge side is the item's `hinge` option; a
 * refrigerator without one, as in the seed catalog, is checked on both sides.
 */
export const applianceFridgeDoor = defineRule('appliance.fridge-door', 'warning', (ctx) =>
  ctx.items.flatMap((placed) => {
    const { wall } = placed;
    if (placed.item.catalogId !== FRIDGE_ID || !wall) return [];
    // A wall is a side wall only if it comes into the room from the corner.
    const inward = (side: WallInfo | undefined, sign: number): number =>
      side ? sign * (side.direction.x * wall.normal.x + side.direction.y * wall.normal.y) : 0;
    const sides: [hinge: string, side: WallInfo | undefined, inward: number, gap: Len][] = [
      ['left', wall.prev, inward(wall.prev, -1), placed.start],
      ['right', wall.next, inward(wall.next, 1), wall.length - placed.end],
    ];
    const hinge = placed.item.options.hinge ?? 'either';
    return sides
      .filter(
        ([on, , turnsIn, gap]) =>
          (hinge === on || hinge === 'either') && turnsIn > 0.5 && gap < FRIDGE_HINGE_CLEARANCE,
      )
      .map(([, side, , gap]) => ({
        itemIds: [placed.item.id, side!.wall.id],
        message: `${placed.label} is ${formatLength(gap)} from wall ${side!.label}. Leave at least ${formatLength(FRIDGE_HINGE_CLEARANCE)} on the hinge side so the door opens fully.`,
      }));
  }),
);
