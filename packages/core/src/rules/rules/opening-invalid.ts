import { formatLength } from '../../units/index.js';
import { openingLabel } from '../context.js';
import { defineRule, type Finding } from '../types.js';

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** An opening that runs past its wall, reaches above it, or overlaps another opening. */
export const openingInvalid = defineRule('opening.invalid', 'error', (ctx) => {
  const findings: Finding[] = [];
  for (const wall of ctx.walls) {
    wall.openings.forEach((opening, i) => {
      const end = opening.offset + opening.width;
      const top = opening.sillHeight + opening.height;
      const problems = [
        ...(end > wall.length
          ? [
              `ends at ${formatLength(end)}, past the end of the wall (${formatLength(wall.length)} long)`,
            ]
          : []),
        ...(top > wall.height
          ? [`reaches ${formatLength(top)}, above the wall (${formatLength(wall.height)} high)`]
          : []),
      ];
      if (problems.length > 0) {
        findings.push({
          itemIds: [opening.id],
          message: `${capitalized(openingLabel(opening, wall))} ${problems.join(' and ')}.`,
        });
      }
      for (const other of wall.openings.slice(i + 1)) {
        if (
          opening.offset < other.offset + other.width &&
          other.offset < end &&
          opening.sillHeight < other.sillHeight + other.height &&
          other.sillHeight < top
        ) {
          findings.push({
            itemIds: [opening.id, other.id],
            message: `${capitalized(openingLabel(opening, wall))} overlaps ${openingLabel(other)}.`,
          });
        }
      }
    });
  }
  return findings;
});
