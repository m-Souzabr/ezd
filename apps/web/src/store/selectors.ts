import {
  type DesignDocument,
  type Id,
  inches,
  itemFootprint,
  type Pt,
  type Severity,
  type Violation,
  wallLength,
  wallNormal,
} from '@ezd/core';

import { countertopFootprint, findTarget, wallOf, wallRect } from '../editor/tools/select';
import {
  type Bounds,
  boundsOf,
  fitBounds,
  MAX_FIT_SCALE,
  type Size,
  type Viewport,
} from '../editor/viewport';
import type { DesignStore, View } from './designStore';

export const canUndo = (state: DesignStore): boolean => state.history.past.length > 0;
export const canRedo = (state: DesignStore): boolean => state.history.future.length > 0;

/** The single selected id, or undefined when nothing or several things are selected. */
export const selectedId = (state: DesignStore): Id | undefined =>
  state.selection.length === 1 ? state.selection[0] : undefined;

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** The worst severity among the violations each item, opening or wall is involved in. */
export function severityById(violations: readonly Violation[]): Map<Id, Severity> {
  const worst = new Map<Id, Severity>();
  for (const violation of violations) {
    for (const id of violation.itemIds) {
      const current = worst.get(id);
      if (!current || RANK[violation.severity] < RANK[current]) worst.set(id, violation.severity);
    }
  }
  return worst;
}

export const violationsFor = (violations: readonly Violation[], id: Id): Violation[] =>
  violations.filter((violation) => violation.itemIds.includes(id));

/** What an empty design shows: a 12 by 10 ft area at the origin. */
const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: inches(144), maxY: inches(120) };
/** Room around an elevation for its dimension strings. */
const ELEVATION_MARGIN = inches(14);

function entityPoints(doc: DesignDocument, id: Id): Pt[] {
  const target = findTarget(doc, id);
  if (!target) return [];
  switch (target.kind) {
    case 'item':
      return itemFootprint(doc, target.item) ?? [];
    case 'countertop':
      return countertopFootprint(doc, target.countertop) ?? [];
    case 'opening': {
      const wall = wallOf(doc, target.opening.wallId);
      const { offset, width } = target.opening;
      return wall ? wallRect(wall, offset, offset + width, -wall.thickness) : [];
    }
    case 'wall':
      return wallRect(target.wall, 0, wallLength(target.wall), -target.wall.thickness);
  }
}

/** The plan bounds of the given entities, or null if none of them is in the document. */
export const planBoundsOf = (doc: DesignDocument, ids: readonly Id[]): Bounds | null =>
  boundsOf(ids.flatMap((id) => entityPoints(doc, id)));

/** Everything the view draws, in drawing coordinates. */
export function contentBounds(doc: DesignDocument, view: View): Bounds {
  if (view.kind === 'elevation') {
    const wall = wallOf(doc, view.wallId);
    if (!wall) return EMPTY_BOUNDS;
    const height = wall.height ?? doc.room.ceilingHeight;
    return {
      minX: -ELEVATION_MARGIN,
      minY: -height - ELEVATION_MARGIN,
      maxX: wallLength(wall) + ELEVATION_MARGIN,
      maxY: ELEVATION_MARGIN,
    };
  }
  const ids = [...doc.room.walls, ...doc.items].map((entity) => entity.id);
  return planBoundsOf(doc, ids) ?? EMPTY_BOUNDS;
}

/** The viewport that frames the whole view. */
export const fitView = (doc: DesignDocument, view: View, size: Size): Viewport =>
  fitBounds(contentBounds(doc, view), size, view.kind === 'plan' ? MAX_FIT_SCALE : undefined);

/** Unit vector pointing out of the room from a wall. */
export const wallOutward = (wall: Parameters<typeof wallNormal>[0]): Pt => {
  const normal = wallNormal(wall);
  return { x: -normal.x || 0, y: -normal.y || 0 };
};
