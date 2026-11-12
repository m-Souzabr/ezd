import { isClosedLoop } from '../../geometry/index.js';
import { defineRule } from '../types.js';

/** Walls that do not form a closed loop. A document with no walls yet has nothing to close. */
export const roomOpen = defineRule('room.open', 'info', (ctx) => {
  const { walls } = ctx;
  if (walls.length === 0 || isClosedLoop(ctx.doc.room.walls)) return [];
  const open = walls.find((wall, i) => wall.next !== walls[(i + 1) % walls.length]);
  return [
    {
      itemIds: [(open ?? walls[0]!).wall.id],
      message: open
        ? `The room is open: wall ${open.label} does not end where the next wall starts.`
        : 'The room is open: it takes at least three walls to close it.',
    },
  ];
});
