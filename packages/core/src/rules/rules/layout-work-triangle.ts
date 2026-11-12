import type { Pt } from '../../geometry/index.js';
import { formatLength } from '../../units/index.js';
import type { PlacedItem } from '../context.js';
import {
  FRIDGE_ID,
  RANGE_ID,
  SINK_ID,
  WORK_TRIANGLE_MAX,
  WORK_TRIANGLE_MIN,
} from '../constants.js';
import { defineRule } from '../types.js';

const centre = ({ footprint }: PlacedItem): Pt => ({
  x: (footprint[0].x + footprint[2].x) / 2,
  y: (footprint[0].y + footprint[2].y) / 2,
});
const distance = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The legs between the centres of the first sink base, range and refrigerator sum to less
 * than 156 in or more than 312 in. Says nothing until the design has all three.
 */
export const layoutWorkTriangle = defineRule('layout.work-triangle', 'info', (ctx) => {
  const [sink, range, fridge] = [SINK_ID, RANGE_ID, FRIDGE_ID].map((id) =>
    ctx.items.find((placed) => placed.item.catalogId === id),
  );
  if (!sink || !range || !fridge) return [];
  const [a, b, c] = [centre(sink), centre(range), centre(fridge)];
  const total = Math.round(distance(a, b) + distance(b, c) + distance(c, a));
  if (total >= WORK_TRIANGLE_MIN && total <= WORK_TRIANGLE_MAX) return [];
  return [
    {
      itemIds: [sink.item.id, range.item.id, fridge.item.id],
      message: `The work triangle between the sink, range and refrigerator is ${formatLength(total)} around, ${total < WORK_TRIANGLE_MIN ? 'under' : 'over'} the recommended ${formatLength(WORK_TRIANGLE_MIN)} to ${formatLength(WORK_TRIANGLE_MAX)}.`,
    },
  ];
});
