import type { ConstraintCode } from '../catalog/index.js';
import type { Command } from '../commands/index.js';
import type { Len } from '../units/index.js';
import type { PlacedItem, RuleContext } from './context.js';
import type { Finding } from './types.js';

// Shared by more than one rule.

/** Moves an item along the wall it is on. */
export const moveAlongWall = (placed: PlacedItem, offset: Len): Command => ({
  type: 'item.move',
  id: placed.item.id,
  placement: { type: 'wall', wallId: placed.wall!.wall.id, offset },
});

/**
 * One finding for each item with catalog errors of the given codes, saying all of them.
 * `fix` gets only items the catalog has an entry for.
 */
export function catalogFindings(
  ctx: RuleContext,
  codes: readonly ConstraintCode[],
  fix?: (placed: PlacedItem) => Command[],
): Finding[] {
  return ctx.items.flatMap((placed) => {
    const errors = placed.errors.filter((error) => codes.includes(error.code));
    if (errors.length === 0) return [];
    return [
      {
        itemIds: [placed.item.id],
        message: `${placed.label}: ${errors.map((error) => error.message).join(' ')}`,
        ...(fix && { fix: fix(placed) }),
      },
    ];
  });
}
