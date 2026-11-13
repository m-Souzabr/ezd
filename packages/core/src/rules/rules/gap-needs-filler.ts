import { defaultItemFor } from '../../catalog/index.js';
import type { ItemKind } from '../../document/index.js';
import { EPS, reachAlongWall } from '../../geometry/index.js';
import { formatLength, type Len } from '../../units/index.js';
import { type PlacedItem, the, verticalOverlap } from '../context.js';
import { defineRule, type Finding } from '../types.js';

const CABINETS = new Set<ItemKind>(['base', 'wall', 'tall', 'corner']);

/** Something beside a cabinet: where it is along the cabinet's wall. */
type Neighbour = { placed: PlacedItem; start: Len; end: Len; sameWall: boolean };

/**
 * A gap too narrow for a cabinet between a cabinet and the next thing at its height: an
 * item on its wall, an item on another wall that reaches its wall in the corner, or the
 * end of the wall. A gap of 6 in or less comes with a filler that closes it.
 */
export const gapNeedsFiller = defineRule('gap.needs-filler', 'warning', (ctx) => {
  const findings: Finding[] = [];
  const { minCabinetGap, maxFillerGap } = ctx.config.thresholds;

  const report = (
    cabinet: PlacedItem,
    from: Len,
    to: Len,
    neighbour: PlacedItem | undefined,
    side: 'start' | 'end',
  ) => {
    const gap = to - from;
    if (gap <= 0 || gap >= minCabinetGap) return;
    // The filler matches the shorter of the two, so it fits beside both.
    const model = neighbour && neighbour.item.height < cabinet.item.height ? neighbour : cabinet;
    const filler =
      gap <= maxFillerGap
        ? ctx.catalog.entries.find(
            (entry) =>
              entry.kind === 'filler' &&
              'free' in entry.width &&
              entry.width.free.min <= gap &&
              gap <= entry.width.free.max &&
              entry.heights.includes(model.item.height) &&
              entry.placement.includes('wall'),
          )
        : undefined;
    const what = neighbour ? the(neighbour.label) : `the ${side} of the wall`;
    const advice = filler
      ? `Add a ${formatLength(gap)} filler.`
      : `Close the gap, or widen it to at least ${formatLength(minCabinetGap)} to fit a cabinet.`;
    findings.push({
      itemIds: neighbour ? [cabinet.item.id, neighbour.item.id] : [cabinet.item.id],
      message: `${cabinet.label} is ${formatLength(gap)} from ${what}. ${advice}`,
      ...(filler && {
        fix: [
          {
            type: 'item.add',
            item: {
              ...defaultItemFor(filler, ctx.newId('filler'), {
                type: 'wall',
                wallId: cabinet.wall!.wall.id,
                offset: from,
              }),
              width: gap,
              height: model.item.height,
              elevation: model.item.elevation,
            },
          },
        ],
      }),
    });
  };

  for (const wall of ctx.walls) {
    const cabinets = wall.items.filter((placed) => CABINETS.has(placed.item.kind));
    if (cabinets.length === 0) continue;

    const neighbours: Neighbour[] = wall.items.map((placed) => ({
      placed,
      start: placed.start,
      end: placed.end,
      sameWall: true,
    }));
    // Only an item whose bounding box touches the wall's can reach the wall's face.
    const { start, end } = wall.wall;
    const minX = Math.min(start.x, end.x) - EPS;
    const maxX = Math.max(start.x, end.x) + EPS;
    const minY = Math.min(start.y, end.y) - EPS;
    const maxY = Math.max(start.y, end.y) + EPS;
    for (const placed of ctx.items) {
      if (
        !placed.wall ||
        placed.wall === wall ||
        placed.maxX < minX ||
        placed.minX > maxX ||
        placed.maxY < minY ||
        placed.minY > maxY
      ) {
        continue;
      }
      const reach = reachAlongWall(wall.wall, wall.length, placed.footprint);
      if (reach) neighbours.push({ placed, start: reach[0], end: reach[1], sameWall: false });
    }

    for (const cabinet of cabinets) {
      let left: Neighbour | undefined;
      let right: Neighbour | undefined;
      for (const other of neighbours) {
        if (!verticalOverlap(other.placed, cabinet)) continue;
        if (other.end <= cabinet.start && (!left || other.end > left.end)) left = other;
        if (other.start >= cabinet.end && (!right || other.start < right.start)) right = other;
      }
      // A cabinet to the left reports the gap between the two from its own right side.
      const reported = left?.sameWall && CABINETS.has(left.placed.item.kind);
      if (!reported) report(cabinet, left?.end ?? 0, cabinet.start, left?.placed, 'start');
      report(cabinet, cabinet.end, right?.start ?? wall.length, right?.placed, 'end');
    }
  }
  return findings;
});
