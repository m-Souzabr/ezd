import { formatLength } from '../../units/index.js';
import { defineRule } from '../types.js';

/** An item whose top is above the ceiling, or above its wall if that is lower. */
export const itemExceedsCeiling = defineRule('item.exceeds-ceiling', 'error', (ctx) => {
  const { ceilingHeight } = ctx.doc.room;
  return ctx.items.flatMap((placed) => {
    const { wall, top } = placed;
    const limit = wall ? wall.height : ceilingHeight;
    if (top <= limit) return [];
    const what = limit < ceilingHeight ? `the top of wall ${wall!.label}` : 'the ceiling';
    return [
      {
        itemIds: [placed.item.id],
        message: `${placed.label} reaches ${formatLength(top)}, above ${what} at ${formatLength(limit)}.`,
      },
    ];
  });
});
