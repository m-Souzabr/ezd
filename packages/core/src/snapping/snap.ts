import { allowedWidths, type Catalog, getEntry } from '../catalog/index.js';
import type { Command } from '../commands/index.js';
import type { DesignDocument, Id, Item, Placement, Point, Wall } from '../document/index.js';
import {
  distancePointToWall,
  pointInWallFrame,
  pointOnWall,
  type Pt,
  rangesOverlap,
  wallIntervals,
  wallLength,
  wallNormal,
} from '../geometry/index.js';
import { validateCommand, type Violation } from '../rules/index.js';
import { inches, type Len, STEP } from '../units/index.js';

export type SnapOptions = {
  /** How near a wall's interior face the pointer must be for the wall to take the item. */
  wallCaptureDistance?: Len;
  /** How near a neighbour, wall end or opening edge an item must be to go flush against it. */
  edgeSnapDistance?: Len;
  grid?: Len;
  /** In degrees. */
  freeRotationStep?: number;
};

export const DEFAULT_SNAP_OPTIONS: Required<SnapOptions> = {
  wallCaptureDistance: inches(12),
  edgeSnapDistance: inches(1.5),
  grid: STEP,
  freeRotationStep: 90,
};

export type SnapInput = {
  doc: DesignDocument;
  catalog: Catalog;
  /** The item being dragged, with its current size. */
  item: Item;
  /**
   * Where the middle of the item is being dragged to, in plan. May be fractional. On a
   * wall it sets the middle of the item's width; in the open, the centre of its footprint.
   */
  pointer: Point;
  /** The item's own id when moving an item the document already has. */
  excludeItemId?: Id;
  options?: SnapOptions;
};

/** A line to draw while dragging, showing what the item snapped to. */
export type SnapGuide = {
  kind: 'edge' | 'wall-end' | 'opening' | 'grid';
  from: Point;
  to: Point;
};

export type SnapResult = {
  placement: Placement;
  elevation: Len;
  guides: SnapGuide[];
  /** What dropping the item here would add to the document's violations. */
  introduced: Violation[];
};

type Snapped = Pick<SnapResult, 'placement' | 'guides'>;

/** The nearest multiple of `grid`. Never a negative zero. */
const toGrid = (value: number, grid: Len): Len => Math.round(value / grid) * grid + 0;

/** The nearest wall whose interior face is within `reach` of the pointer. */
function captureWall(doc: DesignDocument, pointer: Pt, reach: number): Wall | undefined {
  let nearest: Wall | undefined;
  let best = reach;
  for (const wall of doc.room.walls) {
    const distance = distancePointToWall(pointer, wall);
    if (distance <= best && (nearest === undefined || distance < best)) {
      nearest = wall;
      best = distance;
    }
  }
  return nearest;
}

function snapToWall(
  { doc, item, pointer, excludeItemId }: SnapInput,
  wall: Wall,
  elevation: Len,
  options: Required<SnapOptions>,
): Snapped {
  const { width } = item;
  const length = Math.round(wallLength(wall));
  const max = Math.max(0, length - width);
  const projected = pointInWallFrame(wall, pointer).along - width / 2;

  // Each candidate puts the item's left edge at `offset`, flush with something at `at`.
  type Candidate = { offset: Len; kind: SnapGuide['kind']; at: Len };
  const candidates: Candidate[] = [
    { offset: 0, kind: 'wall-end', at: 0 },
    { offset: length - width, kind: 'wall-end', at: length },
  ];
  const band = [elevation, elevation + item.height] as const;
  for (const interval of wallIntervals(doc, wall.id)) {
    if (interval.id === excludeItemId) continue;
    const kind = interval.kind === 'opening' ? 'opening' : 'edge';
    // Only items in the same height band are neighbours. An opening counts at any height.
    if (kind === 'edge' && !rangesOverlap([interval.bottom, interval.top], band)) continue;
    candidates.push(
      { offset: interval.end, kind, at: interval.end },
      { offset: interval.start - width, kind, at: interval.start },
    );
  }

  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (candidate.offset < 0 || candidate.offset > max) continue;
    const distance = Math.abs(candidate.offset - projected);
    if (distance > options.edgeSnapDistance) continue;
    if (!best || distance < Math.abs(best.offset - projected)) best = candidate;
  }
  const offset = best ? best.offset : Math.min(max, Math.max(0, toGrid(projected, options.grid)));

  // One guide for everything the item ended up flush with, or one for the grid.
  const flush: Candidate[] = best
    ? candidates.filter((candidate) => candidate.offset === offset)
    : [{ offset, kind: 'grid', at: offset }];
  const normal = wallNormal(wall);
  const guides = new Map<string, SnapGuide>();
  for (const { kind, at } of flush) {
    const from = pointOnWall(wall, at);
    const to = { x: from.x + normal.x * item.depth, y: from.y + normal.y * item.depth };
    guides.set(`${kind}:${at}`, { kind, from, to });
  }
  return { placement: { type: 'wall', wallId: wall.id, offset }, guides: [...guides.values()] };
}

function snapFree({ item, pointer }: SnapInput, options: Required<SnapOptions>): Snapped {
  const current = item.placement.type === 'free' ? item.placement.rotation : 0;
  const rotation = Math.round(toGrid(current, options.freeRotationStep)) % 360;
  const angle = (rotation * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  // The pointer is the centre of the footprint; the placement is its back left corner.
  const x = toGrid(pointer.x - (along.x * item.width - along.y * item.depth) / 2, options.grid);
  const y = toGrid(pointer.y - (along.y * item.width + along.x * item.depth) / 2, options.grid);
  return {
    placement: { type: 'free', x, y, rotation },
    guides: [
      {
        kind: 'grid',
        from: { x, y },
        to: { x: x + along.x * item.width, y: y + along.y * item.width },
      },
    ],
  };
}

/**
 * Turns a pointer position into a good placement for the item being dragged. Pure.
 *
 * Near a wall, an item that can go on one is placed against it: flush with a neighbour in
 * its height band, a wall end or an opening edge if one is within `edgeSnapDistance`, and
 * on the grid from the wall start otherwise, always inside the wall. Away from every
 * wall, an item that can stand free is put on the grid at a rotation that is a multiple
 * of `freeRotationStep`, and an item that cannot goes on the nearest wall however far.
 * With no wall to go on, such an item keeps the placement it has.
 *
 * The elevation is the catalog entry's default for a new item and the item's own when
 * moving one the document already has. Every length in the result is an integer `Len`.
 */
export function snap(input: SnapInput): SnapResult {
  const { doc, catalog, item, pointer, excludeItemId } = input;
  const options = { ...DEFAULT_SNAP_OPTIONS, ...input.options };
  const entry = getEntry(catalog, item.catalogId);
  const allowed = entry ? entry.placement : (['wall', 'free'] as const);
  const elevation = entry && excludeItemId === undefined ? entry.defaultElevation : item.elevation;

  const free = allowed.includes('free');
  const wall = allowed.includes('wall')
    ? captureWall(doc, pointer, free ? options.wallCaptureDistance : Infinity)
    : undefined;
  const { placement, guides } = wall
    ? snapToWall(input, wall, elevation, options)
    : free
      ? snapFree(input, options)
      : { placement: item.placement, guides: [] };

  const command: Command =
    excludeItemId === undefined
      ? { type: 'item.add', item: { ...item, placement, elevation } }
      : { type: 'item.move', id: excludeItemId, placement, elevation };
  const checked = validateCommand(doc, catalog, command);
  return { placement, elevation, guides, introduced: checked.ok ? checked.value.introduced : [] };
}

/** The allowed width nearest `target` that is no more than `limit`, or `fallback`. */
function fitWidth(widths: Len[], target: number, limit: number, fallback: Len): Len {
  let best: Len | undefined;
  for (const width of widths) {
    if (width > limit) continue;
    if (best === undefined || Math.abs(width - target) < Math.abs(best - target)) best = width;
  }
  return best ?? fallback;
}

/** With no catalog entry to say otherwise, a width is a multiple of 3 in up to 10 ft. */
const STEP_WIDTHS: Len[] = Array.from({ length: 40 }, (_, i) => (i + 1) * STEP);

/**
 * The size and placement an item gets when its left or right handle is dragged to the
 * pointer: the nearest width its catalog entry allows (3 in steps for a cabinet), with the
 * opposite edge staying where it is. On a wall, the item never grows past either end. If
 * no allowed width fits, the item keeps the width it has.
 */
export function snapResize(
  doc: DesignDocument,
  catalog: Catalog,
  item: Item,
  edge: 'left' | 'right',
  pointer: Point,
): { width: Len; placement: Placement } {
  const entry = getEntry(catalog, item.catalogId);
  const widths = entry ? allowedWidths(entry) : STEP_WIDTHS;
  const { placement } = item;
  const right = edge === 'right';

  if (placement.type === 'wall') {
    const wall = doc.room.walls.find((candidate) => candidate.id === placement.wallId);
    if (!wall) return { width: item.width, placement };
    const at = pointInWallFrame(wall, pointer).along;
    const end = placement.offset + item.width;
    const width = right
      ? fitWidth(
          widths,
          at - placement.offset,
          Math.round(wallLength(wall)) - placement.offset,
          item.width,
        )
      : fitWidth(widths, end - at, end, item.width);
    return { width, placement: right ? placement : { ...placement, offset: end - width } };
  }

  const angle = (placement.rotation * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  // How far along the item's back edge the pointer is, from its left end.
  const at = (pointer.x - placement.x) * along.x + (pointer.y - placement.y) * along.y;
  const width = fitWidth(widths, right ? at : item.width - at, Infinity, item.width);
  if (right) return { width, placement };
  const shift = item.width - width;
  return {
    width,
    placement: {
      ...placement,
      x: Math.round(placement.x + along.x * shift),
      y: Math.round(placement.y + along.y * shift),
    },
  };
}
