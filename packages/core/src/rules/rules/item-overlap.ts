import { meetInCorner, the } from '../context.js';
import { defineRule } from '../types.js';

/**
 * Two items that overlap in plan and in height. Countertops are not items, so they never
 * count. Items on walls that meet in a corner are `corner.conflict` instead.
 */
export const itemOverlap = defineRule('item.overlap', 'error', (ctx) =>
  ctx
    .overlaps()
    .filter(([a, b]) => !meetInCorner(a, b))
    .map(([a, b]) => ({
      itemIds: [a.item.id, b.item.id],
      message: `${a.label} overlaps ${the(b.label)}.`,
    })),
);
