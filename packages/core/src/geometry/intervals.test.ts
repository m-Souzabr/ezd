import { describe, expect, it } from 'vitest';

import type { DesignDocument } from '../document/index.js';
import { clone } from '../test/fixtures.js';
import { free, kitchen, on, windowAt, door } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import {
  footprintInWallFrame,
  freeGaps,
  itemFootprint,
  pointInWallFrame,
  rangesOverlap,
  wallIntervals,
} from './index.js';

const doc = kitchen(
  [
    on('base.standard', 'wall-north', 60),
    on('wall.standard', 'wall-north', 60),
    on('base.standard', 'wall-north', 0),
    // At the end of the east wall, so its side is against the south wall.
    on('base.standard', 'wall-east', 90),
    // In the middle of the east wall: it reaches no other wall.
    on('base.standard', 'wall-east', 40),
    free('base.standard', 60, 96),
  ],
  { openings: [windowAt('wall-north', 96, 36), door('wall-south', 60, 32)] },
);

describe('pointInWallFrame', () => {
  it('measures along the wall from its start and into the room', () => {
    const east = doc.room.walls[1]!;
    expect(pointInWallFrame(east, { x: inches(144), y: inches(30) })).toEqual({
      along: inches(30),
      into: 0,
    });
    expect(pointInWallFrame(east, { x: inches(120), y: 0 })).toEqual({
      along: 0,
      into: inches(24),
    });
    expect(pointInWallFrame(east, { x: inches(150), y: 0 }).into).toBe(-inches(6));
  });

  it('gives the extent of a footprint in the same frame', () => {
    const south = doc.room.walls[2]!;
    const footprint = itemFootprint(doc, doc.items[3]!)!;
    const { along, into } = footprintInWallFrame(south, footprint);
    expect(along.map((n) => Math.round(n) + 0)).toEqual([0, inches(24)]);
    expect(into.map((n) => Math.round(n) + 0)).toEqual([0, inches(30)]);
  });
});

describe('rangesOverlap', () => {
  it('does not count ranges that only touch', () => {
    expect(rangesOverlap([0, 10], [5, 15])).toBe(true);
    expect(rangesOverlap([0, 10], [10, 15])).toBe(false);
    expect(rangesOverlap([10, 15], [0, 10])).toBe(false);
  });
});

describe('wallIntervals', () => {
  it('lists the items and openings on a wall, sorted, with their vertical ranges', () => {
    expect(wallIntervals(doc, 'wall-north')).toEqual([
      { id: 'item-0002', kind: 'item', start: 0, end: inches(30), bottom: 0, top: inches(34.5) },
      {
        id: 'item-0000',
        kind: 'item',
        start: inches(60),
        end: inches(90),
        bottom: 0,
        top: inches(34.5),
      },
      {
        id: 'item-0001',
        kind: 'item',
        start: inches(60),
        end: inches(90),
        bottom: inches(54),
        top: inches(84),
      },
      {
        id: 'opening-00',
        kind: 'opening',
        start: inches(96),
        end: inches(132),
        bottom: inches(36),
        top: inches(72),
      },
    ]);
  });

  it('includes an item on another wall that reaches this one in the corner', () => {
    expect(wallIntervals(doc, 'wall-south')).toEqual([
      {
        id: 'item-0003',
        kind: 'adjacent',
        start: 0,
        end: inches(24),
        bottom: 0,
        top: inches(34.5),
      },
      {
        id: 'opening-01',
        kind: 'opening',
        start: inches(60),
        end: inches(92),
        bottom: 0,
        top: inches(80),
      },
    ]);
    // The cabinet at the start of the north wall is at the end of the west wall.
    expect(wallIntervals(doc, 'wall-west')).toEqual([
      {
        id: 'item-0002',
        kind: 'adjacent',
        start: inches(96),
        end: inches(120),
        bottom: 0,
        top: inches(34.5),
      },
    ]);
  });

  it('is empty for a wall the document does not have', () => {
    expect(wallIntervals(doc, 'wall-nowhere')).toEqual([]);
    expect(freeGaps(doc, 'wall-nowhere', [0, 1])).toEqual([]);
  });

  it('skips an item on a wall the document does not have', () => {
    const broken = clone(doc) as DesignDocument;
    const item = broken.items[3]!;
    if (item.placement.type === 'wall') item.placement.wallId = 'wall-nowhere';
    expect(wallIntervals(broken, 'wall-south').map((interval) => interval.id)).toEqual([
      'opening-01',
    ]);
  });
});

describe('freeGaps', () => {
  it('returns what is free in a height band', () => {
    const base: [number, number] = [0, inches(34.5)];
    expect(freeGaps(doc, 'wall-north', base)).toEqual([
      [inches(30), inches(60)],
      [inches(90), inches(144)],
    ]);
    // The window is in the way at wall cabinet height.
    expect(freeGaps(doc, 'wall-north', [inches(54), inches(84)])).toEqual([
      [0, inches(60)],
      [inches(90), inches(96)],
      [inches(132), inches(144)],
    ]);
    expect(freeGaps(doc, 'wall-south', base)).toEqual([
      [inches(24), inches(60)],
      [inches(92), inches(144)],
    ]);
    expect(freeGaps(doc, 'wall-west', base)).toEqual([[0, inches(96)]]);
    expect(freeGaps(doc, 'wall-west', [inches(54), inches(84)])).toEqual([[0, inches(120)]]);
  });

  it('merges overlapping intervals and stops at the wall end', () => {
    const crowded = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 20),
      on('base.standard', 'wall-north', 100),
      on('base.standard', 'wall-north', 130),
    ]);
    expect(freeGaps(crowded, 'wall-north', [0, 1])).toEqual([[inches(50), inches(100)]]);
    const past = kitchen([on('base.standard', 'wall-north', 150)]);
    expect(freeGaps(past, 'wall-north', [0, 1])).toEqual([[0, inches(144)]]);
  });
});
