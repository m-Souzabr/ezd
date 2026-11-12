import { type Box, type Catalog, generateParts, type Part } from '../catalog/index.js';
import type { DesignDocument, FinishTarget, Id, Item, Wall } from '../document/index.js';
import {
  isClosedLoop,
  pointOnWall,
  type Pt,
  wallDirection,
  wallLength,
  wallNormal,
} from '../geometry/index.js';
import { IN, type Len } from '../units/index.js';

// Turns a document into boxes and a floor polygon for a 3D renderer. Pure: no renderer
// types, and nothing here is ever stored.
//
// World units are inches, as floats. Plan x is world x, plan y is world z, and elevation
// is world y (up).

export type SceneBox = {
  kind: 'box';
  /** Stable for the same document: `${sourceId}:${index}`. */
  id: string;
  /** The wall, item or countertop the box belongs to. */
  sourceId: Id;
  /** A `PartRole` for an item's box, else `wall` or `countertop`. */
  role: string;
  /** The resolved finish id. Null for appliances and when the catalog has no finish. */
  finish: string | null;
  /** Inches: width (local x), height (y), depth (local z). */
  size: [number, number, number];
  /** Inches, the centre of the box. */
  position: [number, number, number];
  /**
   * Degrees about world y, counterclockwise seen from above, as a right-handed renderer
   * turns a mesh: local x points along (cos, 0, -sin) and local z along (sin, 0, cos).
   * At 0 the box is axis-aligned.
   */
  rotationY: number;
};

export type SceneFloor = {
  kind: 'floor';
  id: string;
  /** World (x, z) corners, in inches. */
  polygon: [number, number][];
  finish: string | null;
};

export type SceneNode = SceneBox | SceneFloor;

/** How far the floor reaches past the walls of a room that is not closed. */
export const OPEN_ROOM_FLOOR_MARGIN: Len = 24 * IN;

/** Rounds float noise away, so a wall at 90 degrees gets exact coordinates. */
const tidy = (n: number): number => Math.round(n * 1e6) / 1e6 || 0;

/**
 * Where local boxes go in plan: `origin` is the back left corner, `along` the unit vector
 * of local x, `into` that of local z, and `angle` the clockwise turn of `along` from +x,
 * in degrees.
 */
type Frame = { origin: Pt; along: Pt; into: Pt; angle: number };

const wallFrame = (wall: Wall, offset: Len): Frame => {
  const along = wallDirection(wall);
  return {
    origin: pointOnWall(wall, offset),
    along,
    into: wallNormal(wall),
    angle: (Math.atan2(along.y, along.x) * 180) / Math.PI,
  };
};

const freeFrame = (x: Len, y: Len, rotation: number): Frame => {
  const radians = (rotation * Math.PI) / 180;
  const along = { x: Math.cos(radians), y: Math.sin(radians) };
  return { origin: { x, y }, along, into: { x: -along.y, y: along.x }, angle: rotation };
};

/** The frame of an item, or null if its wall is not in the document. */
function itemFrame(walls: ReadonlyMap<Id, Wall>, item: Item): Frame | null {
  const { placement } = item;
  if (placement.type === 'free') return freeFrame(placement.x, placement.y, placement.rotation);
  const wall = walls.get(placement.wallId);
  return wall ? wallFrame(wall, placement.offset) : null;
}

/**
 * A box given in a frame, in sixteenths, as a world box in inches. `box.y` is above
 * `baseY`. `turn` rotates the box about the vertical line through its (x, z) corner, as
 * `Part.rotation` does.
 */
function worldBox(
  frame: Frame,
  box: Box,
  baseY: Len,
  turn = 0,
): Pick<SceneBox, 'size' | 'position' | 'rotationY'> {
  const radians = (turn * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // The centre, in the frame's own x and z.
  const cx = box.x + (cos * box.w - sin * box.d) / 2;
  const cz = box.z + (sin * box.w + cos * box.d) / 2;
  const { origin, along, into } = frame;
  const rotationY = tidy((360 - ((frame.angle + turn) % 360)) % 360);
  return {
    size: [box.w / IN, box.h / IN, box.d / IN],
    position: [
      tidy((origin.x + along.x * cx + into.x * cz) / IN),
      tidy((baseY + box.y + box.h / 2) / IN),
      tidy((origin.y + along.y * cx + into.y * cz) / IN),
    ],
    rotationY: rotationY === 360 ? 0 : rotationY,
  };
}

/** The finish to draw a target with when nothing more specific is set. */
function defaultFinish(doc: DesignDocument, catalog: Catalog, target: FinishTarget): string | null {
  return (
    doc.finishes[target] ?? catalog.finishes.find((finish) => finish.target === target)?.id ?? null
  );
}

/**
 * The wall as boxes around its openings: the solid stretches between them, the piece above
 * each one, and the piece below a window. Openings are cut to the wall; where two overlap,
 * the later one keeps only what the earlier one left.
 */
function wallBoxes(doc: DesignDocument, wall: Wall, finish: string | null): SceneBox[] {
  const length = wallLength(wall);
  const height = wall.height ?? doc.room.ceilingHeight;
  const frame = wallFrame(wall, 0);
  const boxes: SceneBox[] = [];
  const push = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 <= x0 || y1 <= y0) return;
    boxes.push({
      kind: 'box',
      id: `${wall.id}:${boxes.length}`,
      sourceId: wall.id,
      role: 'wall',
      finish,
      // The interior face is at local z = 0 and the wall extends away from the room.
      ...worldBox(
        frame,
        { x: x0, y: y0, z: -wall.thickness, w: x1 - x0, h: y1 - y0, d: wall.thickness },
        0,
      ),
    });
  };

  const openings = doc.room.openings
    .filter((opening) => opening.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const opening of openings) {
    const left = Math.max(cursor, opening.offset);
    const right = Math.min(length, opening.offset + opening.width);
    if (right <= left) continue;
    push(cursor, left, 0, height);
    push(left, right, 0, Math.min(opening.sillHeight, height));
    push(left, right, opening.sillHeight + opening.height, height);
    cursor = right;
  }
  push(cursor, length, 0, height);
  return boxes;
}

/**
 * The room's outline when its walls close; otherwise the rectangle around the walls, 24 in
 * larger on every side. A document with no walls has no floor.
 */
function floorNode(doc: DesignDocument, finish: string | null): SceneFloor | null {
  const { walls } = doc.room;
  if (walls.length === 0) return null;
  const node = { kind: 'floor', id: 'floor', finish } as const;
  if (isClosedLoop(walls)) {
    return { ...node, polygon: walls.map((wall) => [wall.start.x / IN, wall.start.y / IN]) };
  }
  const points = walls.flatMap((wall) => [wall.start, wall.end]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x0 = (Math.min(...xs) - OPEN_ROOM_FLOOR_MARGIN) / IN;
  const x1 = (Math.max(...xs) + OPEN_ROOM_FLOOR_MARGIN) / IN;
  const y0 = (Math.min(...ys) - OPEN_ROOM_FLOOR_MARGIN) / IN;
  const y1 = (Math.max(...ys) + OPEN_ROOM_FLOOR_MARGIN) / IN;
  return {
    ...node,
    polygon: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  };
}

/** Carcass and front parts take the cabinet finish; appliance parts take none. */
const takesCabinetFinish = (part: Part): boolean =>
  part.finishSlot === 'carcass' || part.finishSlot === 'front';

/**
 * Everything a 3D view draws, in a fixed order: the floor, the walls in document order,
 * then each item's parts, then the countertops.
 *
 * Finishes resolve from the most specific setting: the item's or countertop's own
 * `finishId`, else the document's finish for the target, else the catalog's first finish
 * for it.
 *
 * Deterministic and pure: the output depends only on the arguments, and neither is
 * changed. An item with no catalog entry, or on a wall that is not in the document, has no
 * boxes.
 */
export function buildScene(doc: DesignDocument, catalog: Catalog): SceneNode[] {
  const nodes: SceneNode[] = [];
  const walls = new Map(doc.room.walls.map((wall) => [wall.id, wall]));

  const floor = floorNode(doc, defaultFinish(doc, catalog, 'floor'));
  if (floor) nodes.push(floor);

  const wallFinish = defaultFinish(doc, catalog, 'wall');
  for (const wall of doc.room.walls) nodes.push(...wallBoxes(doc, wall, wallFinish));

  const cabinetFinish = defaultFinish(doc, catalog, 'cabinet');
  for (const item of doc.items) {
    const frame = itemFrame(walls, item);
    if (!frame) continue;
    generateParts(item, catalog).forEach((part, index) => {
      nodes.push({
        kind: 'box',
        id: `${item.id}:${index}`,
        sourceId: item.id,
        role: part.role,
        finish: takesCabinetFinish(part) ? (item.finishId ?? cabinetFinish) : null,
        ...worldBox(frame, part.box, item.elevation, part.rotation),
      });
    });
  }

  const countertopFinish = defaultFinish(doc, catalog, 'countertop');
  for (const countertop of doc.countertops) {
    const wall = walls.get(countertop.wallId);
    if (!wall) continue;
    nodes.push({
      kind: 'box',
      id: `${countertop.id}:0`,
      sourceId: countertop.id,
      role: 'countertop',
      finish: countertop.finishId ?? countertopFinish,
      ...worldBox(
        wallFrame(wall, countertop.startOffset),
        {
          x: 0,
          y: 0,
          z: 0,
          w: countertop.endOffset - countertop.startOffset,
          h: countertop.thickness,
          d: countertop.depth,
        },
        countertop.elevation,
      ),
    });
  }

  return nodes;
}
