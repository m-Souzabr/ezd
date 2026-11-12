import { describe, expect, it } from 'vitest';

import type { Item } from '../document/index.js';
import { sampleDocument } from '../test/fixtures.js';
import { inches } from '../units/index.js';
import {
  EPS,
  itemFootprint,
  itemVerticalRange,
  pointOnWall,
  type Pt,
  wallDirection,
  wallLength,
  wallNormal,
} from './index.js';

const doc = sampleDocument();
const [north, east, south, west] = doc.room.walls as [
  (typeof doc.room.walls)[0],
  (typeof doc.room.walls)[0],
  (typeof doc.room.walls)[0],
  (typeof doc.room.walls)[0],
];
const ROOM = { width: inches(120), depth: inches(96) };

const insideRoom = (p: Pt) =>
  p.x >= -EPS && p.x <= ROOM.width + EPS && p.y >= -EPS && p.y <= ROOM.depth + EPS;

const closeTo = (actual: Pt, expected: Pt) => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(EPS);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(EPS);
};

const cabinet = (placement: Item['placement']): Item => ({
  id: 'item-test-01',
  catalogId: 'base-1-door',
  kind: 'base',
  width: inches(30),
  height: inches(34.5),
  depth: inches(24),
  elevation: 0,
  placement,
  options: {},
});

describe('walls of a 120 in by 96 in room, clockwise', () => {
  it('EPS is 1/32 in', () => {
    expect(EPS).toBe(0.5);
  });

  it('measures wall length in sixteenths', () => {
    expect(wallLength(north)).toBe(inches(120));
    expect(wallLength(east)).toBe(inches(96));
    expect(wallLength({ start: { x: 0, y: 0 }, end: { x: 48, y: 64 } })).toBe(80);
  });

  it('gives unit directions from start to end', () => {
    expect(wallDirection(north)).toEqual({ x: 1, y: 0 });
    expect(wallDirection(east)).toEqual({ x: 0, y: 1 });
    expect(wallDirection(south)).toEqual({ x: -1, y: 0 });
    expect(wallDirection(west)).toEqual({ x: 0, y: -1 });
  });

  it('gives normals that point into the room', () => {
    expect(wallNormal(north)).toEqual({ x: 0, y: 1 });
    expect(wallNormal(east)).toEqual({ x: -1, y: 0 });
    expect(wallNormal(south)).toEqual({ x: 0, y: -1 });
    expect(wallNormal(west)).toEqual({ x: 1, y: 0 });

    for (const wall of doc.room.walls) {
      const middle = pointOnWall(wall, wallLength(wall) / 2);
      const n = wallNormal(wall);
      expect(insideRoom({ x: middle.x + n.x * 16, y: middle.y + n.y * 16 })).toBe(true);
      expect(insideRoom({ x: middle.x - n.x * 16, y: middle.y - n.y * 16 })).toBe(false);
    }
  });

  it('measures offsets from the wall start', () => {
    expect(pointOnWall(north, inches(30))).toEqual({ x: inches(30), y: 0 });
    expect(pointOnWall(south, inches(30))).toEqual({ x: inches(90), y: inches(96) });
    expect(pointOnWall(west, 0)).toEqual({ x: 0, y: inches(96) });
  });

  it('returns zero vectors for a wall with no length', () => {
    const point = { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } };
    expect(wallDirection(point)).toEqual({ x: 0, y: 0 });
    expect(wallNormal(point)).toEqual({ x: 0, y: 0 });
  });
});

describe('itemFootprint', () => {
  it('puts the back on the wall, the left edge at the offset, and the depth into the room', () => {
    const item = cabinet({ type: 'wall', wallId: north.id, offset: inches(12) });
    expect(itemFootprint(doc, item)).toEqual([
      { x: inches(12), y: 0 },
      { x: inches(42), y: 0 },
      { x: inches(42), y: inches(24) },
      { x: inches(12), y: inches(24) },
    ]);
  });

  it('keeps an item on each wall inside the room', () => {
    for (const wall of doc.room.walls) {
      for (const offset of [0, wallLength(wall) - inches(30)]) {
        const footprint = itemFootprint(doc, cabinet({ type: 'wall', wallId: wall.id, offset }));
        expect(footprint).not.toBeNull();
        expect(footprint!.every(insideRoom)).toBe(true);
        // The front edge is one depth away from the wall, on the room side.
        const n = wallNormal(wall);
        const [backLeft, , , frontLeft] = footprint!;
        closeTo(frontLeft, {
          x: backLeft.x + n.x * inches(24),
          y: backLeft.y + n.y * inches(24),
        });
      }
    }
  });

  it('keeps every item of the sample document inside the room', () => {
    for (const item of doc.items) {
      expect(itemFootprint(doc, item)!.every(insideRoom)).toBe(true);
    }
  });

  it('places a free item by its back left corner', () => {
    const item = cabinet({ type: 'free', x: inches(40), y: inches(40), rotation: 0 });
    expect(itemFootprint(doc, item)).toEqual([
      { x: inches(40), y: inches(40) },
      { x: inches(70), y: inches(40) },
      { x: inches(70), y: inches(64) },
      { x: inches(40), y: inches(64) },
    ]);
  });

  it('rotates a free item clockwise about its back left corner', () => {
    const item = cabinet({ type: 'free', x: inches(60), y: inches(40), rotation: 90 });
    const footprint = itemFootprint(doc, item)!;
    closeTo(footprint[0], { x: inches(60), y: inches(40) });
    closeTo(footprint[1], { x: inches(60), y: inches(70) });
    closeTo(footprint[2], { x: inches(36), y: inches(70) });
    closeTo(footprint[3], { x: inches(36), y: inches(40) });
  });

  it('matches a wall placement when a free item is rotated to the wall direction', () => {
    const onWall = itemFootprint(
      doc,
      cabinet({ type: 'wall', wallId: east.id, offset: inches(10) }),
    )!;
    const free = itemFootprint(
      doc,
      cabinet({ type: 'free', x: inches(120), y: inches(10), rotation: 90 }),
    )!;
    free.forEach((corner, i) => closeTo(corner, onWall[i]!));
  });

  it('returns null for an item on a wall that is not in the document', () => {
    const item = cabinet({ type: 'wall', wallId: 'wall-missing', offset: 0 });
    expect(itemFootprint(doc, item)).toBeNull();
  });
});

describe('itemVerticalRange', () => {
  it('runs from the elevation to the elevation plus the height', () => {
    expect(itemVerticalRange({ elevation: inches(54), height: inches(30) })).toEqual([
      inches(54),
      inches(84),
    ]);
  });
});
