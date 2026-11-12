import { openingLabel } from '../context.js';
import { defineRule } from '../types.js';

/** An item on the same stretch of wall as a door or a passage, whatever its height. */
export const itemBlocksDoor = defineRule('item.blocks-door', 'error', (ctx) =>
  ctx.walls.flatMap((wall) =>
    wall.items.flatMap((placed) =>
      wall.openings
        .filter(
          (opening) =>
            opening.kind !== 'window' &&
            placed.start < opening.offset + opening.width &&
            opening.offset < placed.end,
        )
        .map((opening) => ({
          itemIds: [placed.item.id, opening.id],
          message: `${placed.label} overlaps ${openingLabel(opening)}.`,
        })),
    ),
  ),
);
