import { type Command, inches, type Len, STEP, type Wall, wallLength } from '@ezd/core';

import type { NewId } from '../ids';

// The opening tool: pick door or window, then click a wall.

export type OpeningToolKind = 'door' | 'window';

export const OPENING_DEFAULTS: Record<
  OpeningToolKind,
  { width: Len; height: Len; sillHeight: Len }
> = {
  door: { width: inches(32), height: inches(80), sillHeight: 0 },
  window: { width: inches(36), height: inches(48), sillHeight: inches(36) },
};

/**
 * Adds a door or window of the default size, centred on the point `along` the wall where
 * the user clicked, on the 3 in grid and inside the wall.
 */
export function openingCommand(
  wall: Wall,
  kind: OpeningToolKind,
  along: number,
  newId: NewId,
): Command {
  const size = OPENING_DEFAULTS[kind];
  const max = Math.max(0, Math.round(wallLength(wall)) - size.width);
  const offset = Math.min(max, Math.max(0, Math.round((along - size.width / 2) / STEP) * STEP));
  return {
    type: 'opening.add',
    opening: {
      id: newId('opening'),
      wallId: wall.id,
      kind,
      offset,
      ...size,
      ...(kind === 'door' && { swing: 'in-left' as const }),
    },
  };
}
