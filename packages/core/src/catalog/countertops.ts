import type { Command } from '../commands/index.js';
import type { DesignDocument, Id, Item, Wall } from '../document/index.js';
import { wallLength } from '../geometry/index.js';
import type { Len } from '../units/index.js';
import {
  BASE_CABINET_DEPTH,
  BASE_CABINET_HEIGHT,
  COUNTERTOP_OVERHANG,
  COUNTERTOP_THICKNESS,
} from './constants.js';
import { type Catalog, getEntry } from './types.js';

/**
 * A stretch of a wall to cover. `start` and `end` are where the cabinets are; `from` and
 * `to` are where the slab goes once it is trimmed to butt against its neighbour.
 */
export type CountertopRun = { start: Len; end: Len; from: Len; to: Len; depth: Len };
type Run = CountertopRun;
type Span = Pick<Run, 'start' | 'end' | 'depth'>;

/**
 * Whether a countertop goes over the item: anything on a wall that tops out at base
 * cabinet height. That takes in base and base corner cabinets, dishwashers and the
 * fillers and end panels between them, and leaves out ranges, refrigerators and tall
 * cabinets.
 */
export const bearsCountertop = (item: Item): boolean =>
  item.placement.type === 'wall' &&
  item.kind !== 'wall' &&
  item.kind !== 'tall' &&
  item.elevation + item.height === BASE_CABINET_HEIGHT;

const wallLen = (wall: Wall): Len => Math.round(wallLength(wall));

/** The wall that ends where `wall` starts. */
const wallBefore = (doc: DesignDocument, wall: Wall): Wall | undefined =>
  doc.room.walls.find(
    (other) => other.id !== wall.id && other.end.x === wall.start.x && other.end.y === wall.start.y,
  );

/** What the items cover on each wall, by wall id. */
function spansByWall(doc: DesignDocument, catalog: Catalog): Map<Id, Span[]> {
  const spans = new Map<Id, Span[]>(doc.room.walls.map((wall) => [wall.id, []]));
  for (const item of doc.items) {
    if (item.placement.type !== 'wall' || !bearsCountertop(item)) continue;
    const { wallId, offset } = item.placement;
    const lShaped = getEntry(catalog, item.catalogId)?.corner === 'l';
    spans.get(wallId)?.push({
      start: offset,
      end: offset + item.width,
      // An L-shaped corner is only as deep as a base cabinet along each wall.
      depth: lShaped ? BASE_CABINET_DEPTH : item.depth,
    });
    // Its other leg covers the end of the wall before.
    const wall = doc.room.walls.find((candidate) => candidate.id === wallId);
    const before = wall && lShaped && offset === 0 ? wallBefore(doc, wall) : undefined;
    if (before) {
      const end = wallLen(before);
      spans
        .get(before.id)
        ?.push({ start: Math.max(0, end - item.depth), end, depth: BASE_CABINET_DEPTH });
    }
  }
  return spans;
}

/** Joins spans that touch or overlap. Any gap starts a new run. */
function mergeRuns(spans: Span[]): Run[] {
  const runs: Run[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = runs.at(-1);
    if (last && span.start <= last.end) {
      last.end = last.to = Math.max(last.end, span.end);
      last.depth = Math.max(last.depth, span.depth);
    } else {
      runs.push({ ...span, from: span.start, to: span.end });
    }
  }
  return runs;
}

/**
 * The contiguous runs of counter-height items on each wall, by wall id, in order along the
 * wall. A run breaks at a range, a tall cabinet, a refrigerator or any gap.
 *
 * Where two walls meet, the tops are butt-joined: the one whose run reaches the corner
 * keeps its full length, and the other stops at its front edge. A run trimmed to nothing
 * has `to <= from`.
 */
export function countertopRuns(doc: DesignDocument, catalog: Catalog): Map<Id, CountertopRun[]> {
  const spans = spansByWall(doc, catalog);
  const runs = new Map<Id, Run[]>();
  for (const [wallId, wallSpans] of spans) runs.set(wallId, mergeRuns(wallSpans));

  for (const wall of doc.room.walls) {
    const before = wallBefore(doc, wall);
    if (!before) continue;
    const corner = wallLen(before);
    const first = runs.get(wall.id)?.[0];
    const last = runs.get(before.id)?.at(-1);
    if (first?.start === 0) {
      if (last) last.to = Math.min(last.to, corner - (first.depth + COUNTERTOP_OVERHANG));
    } else if (first && last && last.end >= corner) {
      first.from = Math.max(first.from, last.depth + COUNTERTOP_OVERHANG);
    }
  }
  return runs;
}

/**
 * Proposes one rectangular countertop for each run of `countertopRuns`. Runs that already
 * have a countertop over exactly the same stretch are skipped.
 */
export function proposeCountertops(doc: DesignDocument, catalog: Catalog): Command[] {
  const runs = countertopRuns(doc, catalog);

  const used = new Set<Id>(
    [doc.room.walls, doc.room.openings, doc.items, doc.countertops].flatMap((list) =>
      list.map((entity) => entity.id),
    ),
  );
  let serial = 0;
  const nextId = (): Id => {
    let id: Id;
    do {
      serial += 1;
      id = `countertop-${String(serial).padStart(2, '0')}`;
    } while (used.has(id));
    return id;
  };

  const commands: Command[] = [];
  for (const wall of doc.room.walls) {
    for (const run of runs.get(wall.id) ?? []) {
      if (run.to <= run.from) continue;
      const exists = doc.countertops.some(
        (countertop) =>
          countertop.wallId === wall.id &&
          countertop.startOffset === run.from &&
          countertop.endOffset === run.to,
      );
      if (exists) continue;
      commands.push({
        type: 'countertop.add',
        countertop: {
          id: nextId(),
          wallId: wall.id,
          startOffset: run.from,
          endOffset: run.to,
          depth: run.depth + COUNTERTOP_OVERHANG,
          thickness: COUNTERTOP_THICKNESS,
          elevation: BASE_CABINET_HEIGHT,
        },
      });
    }
  }
  return commands;
}
