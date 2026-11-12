import {
  type Command,
  createEmptyDocument,
  inches,
  isClosedLoop,
  type Point,
  wallNormal,
} from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { apply, countingIds, room } from '../../test/kitchen';
import { pointAtLength, roomCommand, roomCorners, snapWallPoint, wallCommands } from './wall';

const p = (x: number, y: number): Point => ({ x: inches(x), y: inches(y) });
/** A pointer position, which need not be exact to 1/16 in. */
const raw = (x: number, y: number) => ({ x: x * 16, y: y * 16 });
const empty = createEmptyDocument({ id: 'design-test01', name: 'Test' });
/** 10 px at 4 px per inch. */
const TOLERANCE = inches(2.5);

const wallsOf = (command: Command | null) => {
  if (command?.type !== 'batch') throw new Error('expected a batch');
  return command.commands.map((add) => {
    if (add.type !== 'wall.add') throw new Error('expected wall.add');
    return add.wall;
  });
};

describe('snapWallPoint', () => {
  it('snaps to the 3 in grid', () => {
    expect(snapWallPoint(empty, [], raw(10.2, 19.6), TOLERANCE)).toEqual(p(9, 21));
  });

  it('snaps to an existing wall end within the tolerance', () => {
    const doc = room(145, 121);
    expect(snapWallPoint(doc, [], raw(143.5, 122), TOLERANCE)).toEqual(p(145, 121));
    // Too far for the wall end, so the grid takes it.
    expect(snapWallPoint(doc, [], raw(140, 110), TOLERANCE)).toEqual(p(141, 111));
  });

  it('snaps back to the first point of the draft, to close the room', () => {
    const draft = [p(1, 1), p(100, 1), p(100, 80)];
    expect(snapWallPoint(empty, draft, raw(2, 2.5), TOLERANCE)).toEqual(p(1, 1));
  });

  it('keeps a wall horizontal or vertical to the previous point', () => {
    // The previous point is off the grid, as after a typed length.
    const draft = [p(0, 0), p(100.5, 0.5)];
    expect(snapWallPoint(empty, draft, raw(101, 60), TOLERANCE)).toEqual(p(100.5, 60));
    expect(snapWallPoint(empty, draft, raw(160, 1.5), TOLERANCE)).toEqual(p(159, 0.5));
  });

  it('never returns the previous point itself', () => {
    const draft = [p(0, 0), p(30, 0)];
    expect(snapWallPoint(empty, draft, raw(30.4, 12.2), TOLERANCE)).toEqual(p(30, 12));
  });
});

describe('pointAtLength', () => {
  it('goes the typed length toward the pointer', () => {
    expect(pointAtLength(p(10, 10), p(50, 10), inches(96.5))).toEqual(p(106.5, 10));
    expect(pointAtLength(p(10, 10), p(10, -4), inches(24))).toEqual(p(10, -14));
    expect(pointAtLength(p(0, 0), p(3, 4), inches(10))).toEqual(p(6, 8));
  });

  it('goes right when there is no direction to follow', () => {
    expect(pointAtLength(p(10, 10), p(10, 10), inches(12))).toEqual(p(22, 10));
  });
});

describe('wallCommands', () => {
  const square = [p(0, 0), p(120, 0), p(120, 96), p(0, 96)];

  it('is one batch of wall.add commands', () => {
    const command = wallCommands([p(0, 0), p(120, 0), p(120, 96)], countingIds());
    expect(command).toMatchObject({ type: 'batch' });
    expect(wallsOf(command)).toMatchObject([
      { id: 'wall-000000', start: p(0, 0), end: p(120, 0) },
      { id: 'wall-000001', start: p(120, 0), end: p(120, 96) },
    ]);
    expect(apply(empty, command!).room.walls).toHaveLength(2);
  });

  it('closes the room when the chain ends where it started', () => {
    const walls = wallsOf(wallCommands([...square, square[0]!], countingIds()));
    expect(walls).toHaveLength(4);
    expect(isClosedLoop(walls)).toBe(true);
  });

  it('makes the walls run clockwise whichever way they were drawn', () => {
    const drawnBackwards = [...square].reverse();
    const walls = wallsOf(wallCommands([...drawnBackwards, drawnBackwards[0]!], countingIds()));
    expect(isClosedLoop(walls)).toBe(true);
    // Every wall's normal points at the middle of the room.
    for (const wall of walls) {
      const normal = wallNormal(wall);
      const toCentre = {
        x: inches(60) - (wall.start.x + wall.end.x) / 2,
        y: inches(48) - (wall.start.y + wall.end.y) / 2,
      };
      expect(normal.x * toCentre.x + normal.y * toCentre.y).toBeGreaterThan(0);
    }
  });

  it('ignores a point clicked twice, as a double-click does', () => {
    const walls = wallsOf(wallCommands([p(0, 0), p(120, 0), p(120, 0)], countingIds()));
    expect(walls).toHaveLength(1);
  });

  it('is null when there is no wall to add', () => {
    expect(wallCommands([], countingIds())).toBeNull();
    expect(wallCommands([p(0, 0)], countingIds())).toBeNull();
    expect(wallCommands([p(0, 0), p(0, 0)], countingIds())).toBeNull();
  });
});

describe('room templates', () => {
  const dims = {
    width: inches(144),
    depth: inches(120),
    notchWidth: inches(48),
    notchDepth: inches(36),
  };

  it.each([
    ['rectangle', 4],
    ['l', 6],
    ['u', 8],
  ] as const)('makes a closed %s room as one batch', (shape, count) => {
    const command = roomCommand(shape, dims, countingIds());
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.type).toBe('batch');
    const doc = apply(empty, command.value);
    expect(doc.room.walls).toHaveLength(count);
    expect(isClosedLoop(doc.room.walls)).toBe(true);
    // Clockwise from the top left: the first wall runs along the top, left to right.
    expect(doc.room.walls[0]).toMatchObject({ start: p(0, 0), end: p(144, 0) });
  });

  it('cuts the corner out of an L and the middle of the bottom out of a U', () => {
    const l = roomCorners('l', dims);
    expect(l.ok && l.value).toEqual([
      p(0, 0),
      p(144, 0),
      p(144, 84),
      p(96, 84),
      p(96, 120),
      p(0, 120),
    ]);
    const u = roomCorners('u', dims);
    expect(u.ok && u.value).toEqual([
      p(0, 0),
      p(144, 0),
      p(144, 120),
      p(96, 120),
      p(96, 84),
      p(48, 84),
      p(48, 120),
      p(0, 120),
    ]);
  });

  it('refuses dimensions that do not make a room', () => {
    expect(roomCommand('rectangle', { ...dims, width: 0 }, countingIds()).ok).toBe(false);
    expect(roomCommand('l', { ...dims, notchWidth: 0 }, countingIds()).ok).toBe(false);
    const tooBig = roomCommand('u', { ...dims, notchDepth: inches(120) }, countingIds());
    expect(!tooBig.ok && tooBig.error).toBe('The cut-out must be smaller than the room.');
  });
});
