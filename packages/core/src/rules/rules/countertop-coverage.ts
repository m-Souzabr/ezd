import {
  bearsCountertop,
  COUNTERTOP_OVERHANG,
  countertopRuns,
  proposeCountertops,
} from '../../catalog/index.js';
import { formatLength } from '../../units/index.js';
import { defineRule, type Finding } from '../types.js';

/**
 * A run of base cabinets that no countertop covers from end to end, or a countertop that
 * runs more than an overhang past the cabinets under it.
 */
export const countertopCoverage = defineRule('countertop.coverage', 'info', (ctx) => {
  const findings: Finding[] = [];
  const runs = countertopRuns(ctx.doc, ctx.catalog);
  const proposals = proposeCountertops(ctx.doc, ctx.catalog);
  for (const wall of ctx.walls) {
    const wallRuns = runs.get(wall.wall.id)!;
    const tops = ctx.doc.countertops.filter((top) => top.wallId === wall.wall.id);
    for (const run of wallRuns) {
      // `from` to `to` is where the slab goes once it is trimmed at a corner.
      const over = tops.filter((top) => top.startOffset < run.to && run.from < top.endOffset);
      if (
        run.to <= run.from ||
        over.some((top) => top.startOffset <= run.from && top.endOffset >= run.to)
      ) {
        continue;
      }
      const under = wall.items.filter(
        (placed) =>
          bearsCountertop(placed.item) && placed.start < run.end && run.start < placed.end,
      );
      const stretch = `from ${formatLength(run.from)} to ${formatLength(run.to)}`;
      findings.push({
        itemIds: [...under.map((placed) => placed.item.id), wall.wall.id],
        message: `The base run on wall ${wall.label} ${stretch} ${over.length > 0 ? 'is only partly covered by a countertop' : 'has no countertop'}.`,
        ...(over.length === 0 && {
          fix: proposals.filter(
            (command) =>
              command.type === 'countertop.add' &&
              command.countertop.wallId === wall.wall.id &&
              command.countertop.startOffset === run.from,
          ),
        }),
      });
    }
    for (const top of tops) {
      const supported = wallRuns.some(
        (run) =>
          run.start - COUNTERTOP_OVERHANG <= top.startOffset &&
          top.endOffset <= run.end + COUNTERTOP_OVERHANG,
      );
      if (supported) continue;
      findings.push({
        itemIds: [top.id],
        message: `The countertop on wall ${wall.label} from ${formatLength(top.startOffset)} to ${formatLength(top.endOffset)} extends past the cabinets under it.`,
      });
    }
  }
  return findings;
});
