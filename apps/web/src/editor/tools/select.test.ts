import { inches, SEED_CATALOG } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { apply, room, seedItem, WALLS } from '../../test/kitchen';
import { openingCommand } from './opening';
import { startsPan, wheelZoomFactor } from './pan';
import {
  findTarget,
  handleAt,
  hitTest,
  isResizable,
  nextInTabOrder,
  resizeHandles,
  tabOrder,
  wallAt,
} from './select';

const [A, B, C] = WALLS;
const at = (x: number, y: number) => ({ x: inches(x), y: inches(y) });
const TOLERANCE = inches(1);

const kitchen = () => {
  const doc = room(
    144,
    120,
    seedItem('item-base01', 'base.standard', A, 12),
    seedItem('item-wall01', 'wall.standard', A, 12),
    seedItem('item-sink01', 'base.sink', B, 30),
    {
      ...seedItem('item-island', 'base.standard', A, 0),
      placement: { type: 'free', x: inches(48), y: inches(60), rotation: 0 },
    },
  );
  return apply(
    doc,
    openingCommand(doc.room.walls[0]!, 'door', inches(100), () => 'opening-door1'),
    {
      type: 'countertop.add',
      countertop: {
        id: 'countertop-01',
        wallId: A,
        startOffset: inches(12),
        endOffset: inches(42),
        depth: inches(25.5),
        thickness: inches(1.5),
        elevation: inches(34.5),
      },
    },
  );
};

describe('hitTest', () => {
  const doc = kitchen();

  it('finds the item under the pointer', () => {
    expect(hitTest(doc, at(20, 20), TOLERANCE)).toMatchObject({ kind: 'item', id: 'item-base01' });
    expect(hitTest(doc, at(60, 70), TOLERANCE)).toMatchObject({ kind: 'item', id: 'item-island' });
    // Wall B runs down the right side; an item on it reaches 24 in into the room.
    expect(hitTest(doc, at(130, 40), TOLERANCE)).toMatchObject({ id: 'item-sink01' });
  });

  it('hits a wall cabinet before the base cabinet under it', () => {
    expect(hitTest(doc, at(20, 6), TOLERANCE)).toMatchObject({ id: 'item-wall01' });
  });

  it('finds a countertop where it overhangs its cabinets', () => {
    expect(hitTest(doc, at(20, 25), TOLERANCE)).toMatchObject({
      kind: 'countertop',
      id: 'countertop-01',
    });
  });

  it('finds an opening before the wall it is in, and the wall elsewhere', () => {
    expect(hitTest(doc, at(100, -2), TOLERANCE)).toMatchObject({
      kind: 'opening',
      id: 'opening-door1',
    });
    expect(hitTest(doc, at(60, -2), TOLERANCE)).toMatchObject({ kind: 'wall', id: A });
    expect(hitTest(doc, at(146, 60), TOLERANCE)).toMatchObject({ kind: 'wall', id: B });
  });

  it('finds nothing on the open floor or outside the room', () => {
    expect(hitTest(doc, at(30, 100), TOLERANCE)).toBeNull();
    expect(hitTest(doc, at(-30, -30), TOLERANCE)).toBeNull();
  });

  it('says which wall is under the pointer and how far along it', () => {
    expect(wallAt(doc, at(60, -2), TOLERANCE)).toMatchObject({
      wall: { id: A },
      along: inches(60),
    });
    expect(wallAt(doc, at(60, 119), TOLERANCE)).toMatchObject({
      wall: { id: C },
      along: inches(84),
    });
    expect(wallAt(doc, at(60, 60), TOLERANCE)).toBeNull();
  });
});

describe('findTarget', () => {
  it('looks up anything by id', () => {
    const doc = kitchen();
    expect(findTarget(doc, 'item-base01')?.kind).toBe('item');
    expect(findTarget(doc, 'countertop-01')?.kind).toBe('countertop');
    expect(findTarget(doc, 'opening-door1')?.kind).toBe('opening');
    expect(findTarget(doc, A)?.kind).toBe('wall');
    expect(findTarget(doc, 'nothing-here')).toBeNull();
  });
});

describe('resize handles', () => {
  const doc = kitchen();
  const item = doc.items[0]!;

  it('are in the middle of the left and right sides', () => {
    expect(resizeHandles(doc, item)).toEqual({ left: at(12, 12), right: at(42, 12) });
  });

  it('are hit within the tolerance', () => {
    expect(handleAt(doc, item, at(12.5, 11.5), TOLERANCE)).toBe('left');
    expect(handleAt(doc, item, at(42, 12), TOLERANCE)).toBe('right');
    expect(handleAt(doc, item, at(27, 12), TOLERANCE)).toBeNull();
  });

  it('are offered only for an item that comes in more than one width', () => {
    expect(isResizable(item, SEED_CATALOG)).toBe(true);
    expect(isResizable(seedItem('item-panel1', 'panel.end', A, 0), SEED_CATALOG)).toBe(false);
  });
});

describe('tab order', () => {
  const doc = kitchen();

  it('goes wall by wall, along each wall, then to the free-standing items', () => {
    expect(tabOrder(doc)).toEqual(['item-base01', 'item-wall01', 'item-sink01', 'item-island']);
  });

  it('steps forward and back, and leaves the canvas at either end', () => {
    expect(nextInTabOrder(doc, undefined, false)).toBe('item-base01');
    expect(nextInTabOrder(doc, 'item-base01', false)).toBe('item-wall01');
    expect(nextInTabOrder(doc, 'item-island', false)).toBeNull();
    expect(nextInTabOrder(doc, undefined, true)).toBe('item-island');
    expect(nextInTabOrder(doc, 'item-base01', true)).toBeNull();
    expect(nextInTabOrder(room(), undefined, false)).toBeNull();
  });
});

describe('opening tool', () => {
  const wall = room().room.walls[0]!;

  it('adds a 32 x 80 door centred on the click, on the 3 in grid', () => {
    expect(openingCommand(wall, 'door', inches(100), () => 'opening-000001')).toEqual({
      type: 'opening.add',
      opening: {
        id: 'opening-000001',
        wallId: A,
        kind: 'door',
        offset: inches(84),
        width: inches(32),
        height: inches(80),
        sillHeight: 0,
        swing: 'in-left',
      },
    });
  });

  it('adds a 36 x 48 window with its sill at 36 in', () => {
    expect(openingCommand(wall, 'window', inches(60), () => 'opening-000001')).toMatchObject({
      opening: {
        kind: 'window',
        offset: inches(42),
        width: inches(36),
        height: inches(48),
        sillHeight: inches(36),
      },
    });
  });

  it('keeps the opening inside the wall', () => {
    const near = (along: number) => {
      const command = openingCommand(wall, 'door', inches(along), () => 'opening-000001');
      return command.type === 'opening.add' ? command.opening.offset : NaN;
    };
    expect(near(2)).toBe(0);
    expect(near(143)).toBe(inches(112));
  });
});

describe('pan and zoom gestures', () => {
  it('pans with the pan tool, a space-drag or the middle button', () => {
    expect(startsPan(0, 'pan', false)).toBe(true);
    expect(startsPan(0, 'select', true)).toBe(true);
    expect(startsPan(1, 'select', false)).toBe(true);
    expect(startsPan(0, 'select', false)).toBe(false);
    expect(startsPan(2, 'pan', false)).toBe(false);
  });

  it('zooms in when the wheel scrolls up and out when it scrolls down', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1, 10);
    expect(wheelZoomFactor(100000)).toBe(wheelZoomFactor(200));
  });
});
