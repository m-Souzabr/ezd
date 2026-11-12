import type { DesignDocument, Item, Wall } from '../document/index.js';
import type { Len } from '../units/index.js';

/** A derived plan point, in sixteenths of an inch. May be fractional; never stored. */
export type Pt = { x: number; y: number };

/** Back left, back right, front right, front left. */
export type Footprint = [Pt, Pt, Pt, Pt];

/** The single tolerance for float comparisons: 1/32 in. */
export const EPS = 0.5;

/** Length of the wall's interior face, in sixteenths of an inch. */
export const wallLength = (wall: Pick<Wall, 'start' | 'end'>): number =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

/** Unit vector from the wall start to its end. */
export function wallDirection(wall: Pick<Wall, 'start' | 'end'>): Pt {
  const length = wallLength(wall);
  if (length === 0) return { x: 0, y: 0 };
  return { x: (wall.end.x - wall.start.x) / length, y: (wall.end.y - wall.start.y) / length };
}

/** Unit vector perpendicular to the wall, pointing into the room. */
export function wallNormal(wall: Pick<Wall, 'start' | 'end'>): Pt {
  const d = wallDirection(wall);
  // `-d.y || 0` keeps a negative zero out of the result.
  return { x: -d.y || 0, y: d.x };
}

/** The point on the wall's interior face at `offset` from the wall start. */
export function pointOnWall(wall: Pick<Wall, 'start' | 'end'>, offset: Len): Pt {
  const d = wallDirection(wall);
  return { x: wall.start.x + d.x * offset, y: wall.start.y + d.y * offset };
}

function rectangle(backLeft: Pt, along: Pt, into: Pt, width: Len, depth: Len): Footprint {
  const backRight = { x: backLeft.x + along.x * width, y: backLeft.y + along.y * width };
  return [
    backLeft,
    backRight,
    { x: backRight.x + into.x * depth, y: backRight.y + into.y * depth },
    { x: backLeft.x + into.x * depth, y: backLeft.y + into.y * depth },
  ];
}

/**
 * The item's rectangle in plan. Returns null only if the item sits on a wall that is not
 * in the document, which a valid document rules out.
 */
export function itemFootprint(doc: DesignDocument, item: Item): Footprint | null {
  const { placement } = item;
  if (placement.type === 'wall') {
    const wall = doc.room.walls.find((candidate) => candidate.id === placement.wallId);
    if (!wall) return null;
    return rectangle(
      pointOnWall(wall, placement.offset),
      wallDirection(wall),
      wallNormal(wall),
      item.width,
      item.depth,
    );
  }
  const angle = (placement.rotation * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const into = { x: -along.y, y: along.x };
  return rectangle({ x: placement.x, y: placement.y }, along, into, item.width, item.depth);
}

/** `[bottom, top]` above the floor. */
export const itemVerticalRange = (item: Pick<Item, 'elevation' | 'height'>): [Len, Len] => [
  item.elevation,
  item.elevation + item.height,
];
