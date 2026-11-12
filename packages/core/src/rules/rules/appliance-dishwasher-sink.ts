import { distanceRectToRect, EPS } from '../../geometry/index.js';
import { formatLength } from '../../units/index.js';
import { DISHWASHER_ID, DISHWASHER_SINK_DISTANCE, SINK_ID } from '../constants.js';
import { defineRule } from '../types.js';

/** A dishwasher with no sink base cabinet within 36 in of it. */
export const applianceDishwasherSink = defineRule('appliance.dishwasher-sink', 'warning', (ctx) => {
  const sinks = ctx.items.filter((placed) => placed.item.catalogId === SINK_ID);
  return ctx.items
    .filter(
      (placed) =>
        placed.item.catalogId === DISHWASHER_ID &&
        !sinks.some(
          (sink) =>
            distanceRectToRect(placed.footprint, sink.footprint) <= DISHWASHER_SINK_DISTANCE + EPS,
        ),
    )
    .map((placed) => ({
      itemIds: [placed.item.id],
      message: `${placed.label} is not within ${formatLength(DISHWASHER_SINK_DISTANCE)} of a sink base cabinet.`,
    }));
});
