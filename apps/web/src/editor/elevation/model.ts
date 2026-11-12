import {
  BACKSPLASH_HEIGHT,
  type Catalog,
  type DesignDocument,
  formatLength,
  generateParts,
  type Id,
  type Item,
  type Len,
  type OpeningKind,
  type PartRole,
  wallIntervals,
  wallLength,
} from '@ezd/core';

import { itemCode } from '../labels';
import { wallOf } from '../tools/select';

// What an elevation view draws for one wall, worked out from the same document as the
// plan. Pure, so the two views can be compared in tests.
//
// x is the offset along the wall from its start, which is on the left seen from inside the
// room. y is the height above the floor.

/** `x` and `y` are the rectangle's left and bottom. */
export type ElevationRect = { x: Len; y: Len; w: Len; h: Len };

/** A stretch of a dimension string. A `gap` is a stretch with nothing in it. */
export type DimensionSegment = { from: Len; to: Len; text: string; kind: 'item' | 'gap' };

export type ElevationItem = {
  id: Id;
  item: Item;
  code: string;
  rect: ElevationRect;
  /** Doors, drawer fronts, the toe kick and any other face that shows from the front. */
  fronts: { role: PartRole; rect: ElevationRect }[];
};

export type ElevationModel = {
  wallId: Id;
  length: Len;
  /** The floor line is at 0 and the ceiling line at `height`. */
  height: Len;
  openings: { id: Id; kind: OpeningKind; rect: ElevationRect }[];
  /** Tallest and deepest first, so shallower items are drawn over them. */
  items: ElevationItem[];
  /** Items on a neighbouring wall that reach this one in the corner, seen from the side. */
  adjacent: { id: Id; rect: ElevationRect }[];
  countertops: { id: Id; rect: ElevationRect }[];
  /** The 18 in zone above each countertop. */
  backsplash: ElevationRect[];
  dimensions: {
    /** For the items that stand on the floor. Always spans the wall. */
    bottom: DimensionSegment[];
    /** For the items hung on the wall. Empty when there are none. */
    top: DimensionSegment[];
  };
};

const FRONT_ROLES: ReadonlySet<PartRole> = new Set([
  'door',
  'drawer-front',
  'toe-kick',
  'body',
  'filler',
  'panel',
]);

/** Splits `[0, length]` at the items' edges into item and gap stretches. */
function dimensionString(items: readonly Item[], length: Len): DimensionSegment[] {
  const segments: DimensionSegment[] = [];
  let cursor = 0;
  const gapTo = (to: Len) => {
    if (to > cursor)
      segments.push({ from: cursor, to, text: formatLength(to - cursor), kind: 'gap' });
  };
  const sorted = items
    .map((item) => ({
      start: item.placement.type === 'wall' ? item.placement.offset : 0,
      width: item.width,
    }))
    .sort((a, b) => a.start - b.start);
  for (const { start, width } of sorted) {
    gapTo(start);
    segments.push({ from: start, to: start + width, text: formatLength(width), kind: 'item' });
    cursor = Math.max(cursor, start + width);
  }
  gapTo(length);
  return segments;
}

export function elevationModel(
  doc: DesignDocument,
  catalog: Catalog,
  wallId: Id,
): ElevationModel | null {
  const wall = wallOf(doc, wallId);
  if (!wall) return null;
  const length = Math.round(wallLength(wall));
  const height = Math.min(wall.height ?? doc.room.ceilingHeight, doc.room.ceilingHeight);

  const onWall = doc.items.filter(
    (item) => item.placement.type === 'wall' && item.placement.wallId === wallId,
  );
  const items = onWall
    .map((item): ElevationItem => {
      const offset = item.placement.type === 'wall' ? item.placement.offset : 0;
      return {
        id: item.id,
        item,
        code: itemCode(item),
        rect: { x: offset, y: item.elevation, w: item.width, h: item.height },
        fronts: generateParts(item, catalog)
          .filter((part) => FRONT_ROLES.has(part.role) && part.rotation === undefined)
          .map((part) => ({
            role: part.role,
            rect: {
              x: offset + part.box.x,
              y: item.elevation + part.box.y,
              w: part.box.w,
              h: part.box.h,
            },
          })),
      };
    })
    .sort((a, b) => b.item.depth - a.item.depth || b.item.height - a.item.height);

  const countertops = doc.countertops
    .filter((countertop) => countertop.wallId === wallId)
    .map((countertop) => ({
      id: countertop.id,
      rect: {
        x: countertop.startOffset,
        y: countertop.elevation,
        w: countertop.endOffset - countertop.startOffset,
        h: countertop.thickness,
      },
    }));

  const floorStanding = onWall.filter((item) => item.elevation === 0);
  const hung = onWall.filter((item) => item.elevation > 0);

  return {
    wallId,
    length,
    height,
    openings: doc.room.openings
      .filter((opening) => opening.wallId === wallId)
      .map((opening) => ({
        id: opening.id,
        kind: opening.kind,
        rect: { x: opening.offset, y: opening.sillHeight, w: opening.width, h: opening.height },
      })),
    items,
    adjacent: wallIntervals(doc, wallId)
      .filter((interval) => interval.kind === 'adjacent')
      .map((interval) => ({
        id: interval.id,
        rect: {
          x: interval.start,
          y: interval.bottom,
          w: interval.end - interval.start,
          h: interval.top - interval.bottom,
        },
      })),
    countertops,
    backsplash: countertops.map(({ rect }) => ({
      x: rect.x,
      y: rect.y + rect.h,
      w: rect.w,
      h: BACKSPLASH_HEIGHT,
    })),
    dimensions: {
      bottom: dimensionString(floorStanding, length),
      top: hung.length > 0 ? dimensionString(hung, length) : [],
    },
  };
}

/** The item whose face is under the point, the shallowest first as it is drawn on top. */
export function elevationItemAt(model: ElevationModel, x: number, y: number): ElevationItem | null {
  for (let i = model.items.length - 1; i >= 0; i -= 1) {
    const candidate = model.items[i]!;
    const { rect } = candidate;
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      return candidate;
    }
  }
  return null;
}
