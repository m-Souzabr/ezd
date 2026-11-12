import { formatLength } from '../../units/index.js';
import { planOverlap, the } from '../context.js';
import { HOOD_ID, RANGE_ID, RANGE_OVERHEAD_CLEARANCE } from '../constants.js';
import { defineRule } from '../types.js';

/**
 * Anything but a hood less than 30 in above a range. For a 36 in high range that is
 * anything whose bottom is below 66 in.
 */
export const applianceRangeOverhead = defineRule('appliance.range-overhead', 'warning', (ctx) =>
  ctx.items
    .filter((placed) => placed.item.catalogId === RANGE_ID)
    .flatMap((range) =>
      ctx.items
        .filter(
          (placed) =>
            placed.item.catalogId !== HOOD_ID &&
            placed.bottom >= range.top &&
            placed.bottom < range.top + RANGE_OVERHEAD_CLEARANCE &&
            planOverlap(range, placed),
        )
        .map((placed) => ({
          itemIds: [placed.item.id, range.item.id],
          message: `${placed.label} is only ${formatLength(placed.bottom - range.top)} above ${the(range.label)}. Leave at least ${formatLength(RANGE_OVERHEAD_CLEARANCE)} above a range, unless it is a hood.`,
        })),
    ),
);
