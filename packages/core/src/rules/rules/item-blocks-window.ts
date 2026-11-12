import { formatLength } from '../../units/index.js';
import { openingLabel } from '../context.js';
import { defineRule } from '../types.js';

/**
 * An item in front of a window: on the same stretch of wall and reaching above the sill.
 * A base cabinet whose top is at or below the sill is fine.
 */
export const itemBlocksWindow = defineRule('item.blocks-window', 'error', (ctx) =>
  ctx.walls.flatMap((wall) =>
    wall.items.flatMap((placed) =>
      wall.openings
        .filter(
          (opening) =>
            opening.kind === 'window' &&
            placed.start < opening.offset + opening.width &&
            opening.offset < placed.end &&
            placed.bottom < opening.sillHeight + opening.height &&
            opening.sillHeight < placed.top,
        )
        .map((opening) => ({
          itemIds: [placed.item.id, opening.id],
          message: `${placed.label} overlaps ${openingLabel(opening)}, whose sill is at ${formatLength(opening.sillHeight)}.`,
        })),
    ),
  ),
);
