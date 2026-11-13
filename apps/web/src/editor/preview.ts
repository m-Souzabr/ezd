import type { DesignDocument, Id, Item } from '@ezd/core';

import type { ElevationRect } from './elevation/model';
import { itemCode } from './labels';

// What the views draw for a pending proposal, worked out from the two documents. Pure, so
// the plan and the elevations draw the same ghosts and the tests compare them.

export type PreviewGhosts = {
  /** Items the proposal adds, or changes, as they would be. Drawn green. */
  added: Item[];
  /** Items the proposal removes, or changes, as they are now. Drawn red. */
  removed: Item[];
};

const same = (a: Item, b: Item): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The items that differ between `doc` and `previewDoc`. A changed item is in both lists. */
export function previewGhosts(doc: DesignDocument, previewDoc: DesignDocument): PreviewGhosts {
  const before = new Map(doc.items.map((item) => [item.id, item]));
  const after = new Map(previewDoc.items.map((item) => [item.id, item]));
  return {
    added: previewDoc.items.filter((item) => {
      const old = before.get(item.id);
      return !old || !same(old, item);
    }),
    removed: doc.items.filter((item) => {
      const next = after.get(item.id);
      return !next || !same(next, item);
    }),
  };
}

export type ElevationGhost = { id: Id; code: string; rect: ElevationRect };

/** The ghosts on one wall, as elevation rectangles: x along the wall, y above the floor. */
export function elevationGhosts(
  ghosts: PreviewGhosts,
  wallId: Id,
): { added: ElevationGhost[]; removed: ElevationGhost[] } {
  const onWall = (items: Item[]): ElevationGhost[] =>
    items.flatMap((item) =>
      item.placement.type === 'wall' && item.placement.wallId === wallId
        ? [
            {
              id: item.id,
              code: itemCode(item),
              rect: { x: item.placement.offset, y: item.elevation, w: item.width, h: item.height },
            },
          ]
        : [],
    );
  return { added: onWall(ghosts.added), removed: onWall(ghosts.removed) };
}
