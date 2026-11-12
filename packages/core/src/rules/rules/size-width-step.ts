import { nearestAllowedWidth } from '../../catalog/index.js';
import { catalogFindings } from '../helpers.js';
import { defineRule } from '../types.js';

/** A width off the 3 in step or outside the entry's range. Fillers may be any width in theirs. */
export const sizeWidthStep = defineRule('size.width-step', 'error', (ctx) =>
  catalogFindings(ctx, ['WIDTH_OFF_STEP', 'WIDTH_OUT_OF_RANGE'], (placed) => [
    {
      type: 'item.resize',
      id: placed.item.id,
      width: nearestAllowedWidth(placed.entry!, placed.item.width),
    },
  ]),
);
