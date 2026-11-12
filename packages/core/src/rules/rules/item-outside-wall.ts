import { formatLength } from '../../units/index.js';
import { moveAlongWall } from '../helpers.js';
import { defineRule } from '../types.js';

/**
 * An item that runs past the end of its wall. An offset is never negative, so an item
 * cannot start before the wall does.
 */
export const itemOutsideWall = defineRule('item.outside-wall', 'error', (ctx) =>
  ctx.items.flatMap((placed) => {
    const { wall, end, item } = placed;
    if (!wall || end <= wall.length) return [];
    return [
      {
        itemIds: [item.id],
        message: `${placed.label} ends at ${formatLength(end)}, past the end of wall ${wall.label} (${formatLength(wall.length)} long).`,
        ...(item.width <= wall.length && {
          fix: [moveAlongWall(placed, wall.length - item.width)],
        }),
      },
    ];
  }),
);
