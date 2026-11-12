import type { Command } from '../../commands/index.js';
import { formatLength } from '../../units/index.js';
import { defineRule } from '../types.js';

/** Wall cabinets on one wall whose tops are not level. The fix raises them to the highest. */
export const wallAlignment = defineRule('wall.alignment', 'info', (ctx) =>
  ctx.walls.flatMap((wall) => {
    const cabinets = wall.items.filter((placed) => placed.item.kind === 'wall');
    const tops = [...new Set(cabinets.map((placed) => placed.top))].sort((a, b) => a - b);
    if (tops.length < 2) return [];
    const line = tops.at(-1)!;
    const low = cabinets.filter((placed) => placed.top !== line);
    return [
      {
        itemIds: low.map((placed) => placed.item.id),
        message: `Wall cabinets on wall ${wall.label} have tops at ${tops.map(formatLength).join(' and ')}. Align them at ${formatLength(line)}.`,
        fix: low.map(({ item }): Command => ({
          type: 'item.move',
          id: item.id,
          placement: item.placement,
          elevation: line - item.height,
        })),
      },
    ];
  }),
);
