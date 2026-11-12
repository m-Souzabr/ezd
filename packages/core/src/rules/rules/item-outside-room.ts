import { isClosedLoop, pointInPolygon, segmentCrossesRect } from '../../geometry/index.js';
import { defineRule } from '../types.js';

/** A free-placed item whose footprint crosses a wall or lies outside a closed room. */
export const itemOutsideRoom = defineRule('item.outside-room', 'error', (ctx) => {
  const closed = isClosedLoop(ctx.doc.room.walls);
  const room = ctx.doc.room.walls.map((wall) => wall.start);
  return ctx.items.flatMap((placed) => {
    if (placed.wall) return [];
    const { footprint, item } = placed;
    const crossed = ctx.walls.find(({ wall }) =>
      segmentCrossesRect(footprint, wall.start, wall.end),
    );
    if (crossed) {
      return [
        {
          itemIds: [item.id, crossed.wall.id],
          message: `${placed.label} crosses wall ${crossed.label}.`,
        },
      ];
    }
    // It crosses no wall, so it is inside exactly when its centre is.
    const centre = {
      x: (footprint[0].x + footprint[2].x) / 2,
      y: (footprint[0].y + footprint[2].y) / 2,
    };
    if (!closed || pointInPolygon(centre, room)) return [];
    return [{ itemIds: [item.id], message: `${placed.label} is outside the room.` }];
  });
});
