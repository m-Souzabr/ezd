import {
  type Command,
  DEFAULT_WALL_THICKNESS,
  type DesignDocument,
  err,
  type Len,
  ok,
  type Point,
  type Pt,
  type Result,
  STEP,
} from '@ezd/core';

import type { NewId } from '../ids';

// The wall tool: click, click, ..., then double-click or Enter. Also the room templates,
// which make the same batch of `wall.add` commands from typed dimensions.

/** How near an existing wall end or an axis the pointer must be to snap, in pixels. */
export const WALL_SNAP_PX = 10;

const toGrid = (value: number): Len => Math.round(value / STEP) * STEP + 0;
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * Where the next wall point goes for a pointer at `raw`: on an existing wall end or an
 * earlier point of the draft if one is within `tolerance`, else on the 3 in grid, kept
 * horizontal or vertical to the previous point when the pointer is nearly so.
 */
export function snapWallPoint(
  doc: DesignDocument,
  draft: readonly Point[],
  raw: Pt,
  tolerance: number,
): Point {
  const previous = draft.at(-1);
  const ends = [...draft, ...doc.room.walls.flatMap((wall) => [wall.start, wall.end])];
  let nearest: Point | undefined;
  let best = tolerance;
  for (const end of ends) {
    if (previous && samePoint(end, previous)) continue;
    const distance = Math.hypot(end.x - raw.x, end.y - raw.y);
    if (distance <= best) {
      nearest = end;
      best = distance;
    }
  }
  if (nearest) return { x: nearest.x, y: nearest.y };

  const point = { x: toGrid(raw.x), y: toGrid(raw.y) };
  if (previous) {
    if (Math.abs(raw.y - previous.y) <= tolerance) point.y = previous.y;
    if (Math.abs(raw.x - previous.x) <= tolerance) point.x = previous.x;
  }
  return point;
}

/** The point `length` from `from` in the direction of `toward`; to the right if they coincide. */
export function pointAtLength(from: Point, toward: Pt, length: Len): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: from.x + length, y: from.y };
  return {
    x: Math.round(from.x + (dx / distance) * length),
    y: Math.round(from.y + (dy / distance) * length),
  };
}

/** Twice the signed area. Positive when the points run clockwise on screen (y down). */
const signedArea = (points: readonly Point[]): number =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + (p.x * q.y - q.x * p.y);
  }, 0);

/**
 * One `batch` of `wall.add` commands for a chain of points, or null if there is no wall to
 * add. A chain that ends where it starts closes the room. Walls run clockwise, as the
 * document expects, whichever way the points were drawn.
 */
export function wallCommands(points: readonly Point[], newId: NewId): Command | null {
  // Clicking twice in one place adds no wall.
  let chain = points.filter((point, i) => i === 0 || !samePoint(point, points[i - 1]!));
  const closed = chain.length >= 4 && samePoint(chain[0]!, chain.at(-1)!);
  if (closed) chain = chain.slice(0, -1);
  if (chain.length < 2) return null;
  if (signedArea(chain) < 0) chain = [...chain].reverse();

  const segments = closed ? chain.length : chain.length - 1;
  const commands: Command[] = [];
  for (let i = 0; i < segments; i += 1) {
    commands.push({
      type: 'wall.add',
      wall: {
        id: newId('wall'),
        start: chain[i]!,
        end: chain[(i + 1) % chain.length]!,
        thickness: DEFAULT_WALL_THICKNESS,
      },
    });
  }
  return { type: 'batch', commands, label: 'Add walls' };
}

export type RoomShape = 'rectangle' | 'l' | 'u';

export type RoomDimensions = {
  width: Len;
  depth: Len;
  /** The size of the corner an L leaves out, or of the block a U wraps around. */
  notchWidth: Len;
  notchDepth: Len;
};

export const ROOM_SHAPES: { shape: RoomShape; name: string }[] = [
  { shape: 'rectangle', name: 'Rectangle' },
  { shape: 'l', name: 'L shape' },
  { shape: 'u', name: 'U shape' },
];

/**
 * The corners of a template room, clockwise from the top left at the origin. An L leaves
 * out its bottom right corner; a U wraps around a block in the middle of its bottom side.
 */
export function roomCorners(shape: RoomShape, dims: RoomDimensions): Result<Point[], string> {
  const { width: w, depth: d, notchWidth: nw, notchDepth: nd } = dims;
  if (w <= 0 || d <= 0) return err('The room needs a width and a depth.');
  if (shape === 'rectangle') {
    return ok([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ]);
  }
  if (nw <= 0 || nd <= 0) return err('The cut-out needs a width and a depth.');
  if (nw >= w || nd >= d) return err('The cut-out must be smaller than the room.');
  if (shape === 'l') {
    return ok([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d - nd },
      { x: w - nw, y: d - nd },
      { x: w - nw, y: d },
      { x: 0, y: d },
    ]);
  }
  const left = Math.floor((w - nw) / 2);
  return ok([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: left + nw, y: d },
    { x: left + nw, y: d - nd },
    { x: left, y: d - nd },
    { x: left, y: d },
    { x: 0, y: d },
  ]);
}

/** A template room as one `batch`. */
export function roomCommand(
  shape: RoomShape,
  dims: RoomDimensions,
  newId: NewId,
): Result<Command, string> {
  const corners = roomCorners(shape, dims);
  if (!corners.ok) return corners;
  const command = wallCommands([...corners.value, corners.value[0]!], newId);
  return command ? ok(command) : err('The room has no walls.');
}
