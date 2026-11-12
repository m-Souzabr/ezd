import { getEntry, inches, SEED_CATALOG, STEP } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { apply, countingIds, room, seedItem, WALLS } from '../test/kitchen';
import {
  asOne,
  duplicateCommand,
  freeSpot,
  newItem,
  nudgeCommand,
  removeCommand,
  resizeCommand,
} from './edits';

const [A, B, C] = WALLS;
const base = (id: string, offset: number, wall: string = A) =>
  seedItem(id, 'base.standard', wall, offset);

describe('nudgeCommand', () => {
  it('moves an item 3 in along its wall, the way the arrow points on screen', () => {
    const doc = room(144, 120, base('item-000001', 12), base('item-000002', 12, C));
    const [top, bottom] = doc.items;
    // Wall A runs left to right; wall C, opposite, runs right to left.
    expect(nudgeCommand(doc, top!, 'ArrowRight', false, 'plan')).toMatchObject({
      type: 'item.move',
      placement: { offset: inches(15) },
    });
    expect(nudgeCommand(doc, top!, 'ArrowLeft', false, 'plan')).toMatchObject({
      placement: { offset: inches(9) },
    });
    expect(nudgeCommand(doc, bottom!, 'ArrowRight', false, 'plan')).toMatchObject({
      placement: { offset: inches(9) },
    });
    expect(nudgeCommand(doc, top!, 'ArrowUp', false, 'plan')).toBeNull();
  });

  it('uses up and down on a wall that runs up and down the screen', () => {
    const doc = room(144, 120, base('item-000001', 12, B));
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowDown', false, 'plan')).toMatchObject({
      placement: { offset: inches(15) },
    });
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowRight', false, 'plan')).toBeNull();
  });

  it('moves toward the wall start with the left arrow in an elevation', () => {
    const doc = room(144, 120, base('item-000001', 12, C));
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowLeft', false, 'elevation')).toMatchObject({
      placement: { offset: inches(9) },
    });
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowDown', false, 'elevation')).toBeNull();
  });

  it('moves 1/16 in with Shift on a filler only', () => {
    const filler = seedItem('item-000002', 'filler.base', A, 60);
    const doc = room(144, 120, base('item-000001', 12), filler);
    expect(nudgeCommand(doc, doc.items[1]!, 'ArrowRight', true, 'plan')).toMatchObject({
      placement: { offset: inches(60) + 1 },
    });
    expect(nudgeCommand(doc, doc.items[1]!, 'ArrowRight', false, 'plan')).toMatchObject({
      placement: { offset: inches(60) + STEP },
    });
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowRight', true, 'plan')).toMatchObject({
      placement: { offset: inches(12) + STEP },
    });
  });

  it('stops at the ends of the wall', () => {
    const doc = room(144, 120, base('item-000001', 0), base('item-000002', 113));
    expect(nudgeCommand(doc, doc.items[0]!, 'ArrowLeft', false, 'plan')).toBeNull();
    expect(nudgeCommand(doc, doc.items[1]!, 'ArrowRight', false, 'plan')).toMatchObject({
      placement: { offset: inches(114) },
    });
  });

  it('moves a free-standing item on the plan grid', () => {
    const island = {
      ...base('item-000001', 0),
      placement: { type: 'free' as const, x: inches(48), y: inches(48), rotation: 0 },
    };
    const doc = room(144, 120, island);
    expect(nudgeCommand(doc, island, 'ArrowUp', false, 'plan')).toMatchObject({
      placement: { x: inches(48), y: inches(45) },
    });
    expect(nudgeCommand(doc, island, 'ArrowUp', false, 'elevation')).toBeNull();
  });
});

describe('duplicateCommand', () => {
  it('puts the copy at the next free position on the same wall', () => {
    const doc = room(144, 120, base('item-000001', 12), base('item-000002', 42));
    const command = duplicateCommand(doc, doc.items[0]!, countingIds());
    expect(command).toMatchObject({
      type: 'item.add',
      item: {
        id: 'item-000000',
        catalogId: 'base.standard',
        placement: { type: 'wall', wallId: A, offset: inches(72) },
      },
    });
    const next = apply(doc, command!);
    expect(next.items).toHaveLength(3);
  });

  it('goes back to an earlier gap when there is no room after the item', () => {
    const doc = room(144, 120, base('item-000001', 36), base('item-000002', 114));
    expect(duplicateCommand(doc, doc.items[1]!, countingIds())).toMatchObject({
      item: { placement: { offset: 0 } },
    });
  });

  it('is null when the wall is full', () => {
    const doc = room(60, 120, base('item-000001', 0), base('item-000002', 30));
    expect(duplicateCommand(doc, doc.items[0]!, countingIds())).toBeNull();
  });

  it('ignores items in another height band', () => {
    const wallCabinet = seedItem('item-000002', 'wall.standard', A, 42);
    const doc = room(144, 120, base('item-000001', 12), wallCabinet);
    expect(duplicateCommand(doc, doc.items[0]!, countingIds())).toMatchObject({
      item: { placement: { offset: inches(42) } },
    });
  });

  it('copies a free-standing item beside itself', () => {
    const island = {
      ...base('item-000001', 0),
      placement: { type: 'free' as const, x: inches(48), y: inches(48), rotation: 90 },
    };
    expect(duplicateCommand(room(144, 120, island), island, countingIds())).toMatchObject({
      item: { placement: { type: 'free', x: inches(48), y: inches(78), rotation: 90 } },
    });
  });
});

describe('removeCommand', () => {
  it('removes whatever kind of thing is selected', () => {
    const doc = apply(room(144, 120, base('item-000001', 12)), {
      type: 'opening.add',
      opening: {
        id: 'opening-000001',
        wallId: B,
        kind: 'door',
        offset: inches(12),
        width: inches(32),
        height: inches(80),
        sillHeight: 0,
      },
    });
    expect(removeCommand(doc, ['item-000001'])).toEqual({ type: 'item.remove', id: 'item-000001' });
    expect(removeCommand(doc, ['opening-000001'])).toEqual({
      type: 'opening.remove',
      id: 'opening-000001',
    });
    expect(removeCommand(doc, [C])).toEqual({ type: 'wall.remove', id: C });
    expect(removeCommand(doc, [])).toBeNull();
    expect(removeCommand(doc, ['item-missing'])).toBeNull();
  });

  it('removes several things as one batch', () => {
    const doc = room(144, 120, base('item-000001', 12), base('item-000002', 42));
    expect(removeCommand(doc, ['item-000001', 'item-000002'])).toMatchObject({
      type: 'batch',
      commands: [{ type: 'item.remove' }, { type: 'item.remove' }],
    });
  });
});

describe('resizeCommand', () => {
  const item = base('item-000001', 12);

  it('is null when the width does not change', () => {
    expect(resizeCommand(SEED_CATALOG, item, item.width)).toBeNull();
  });

  it('is one item.resize when only the width changes', () => {
    expect(resizeCommand(SEED_CATALOG, item, inches(36))).toEqual({
      type: 'item.resize',
      id: item.id,
      width: inches(36),
    });
  });

  it('is one batch when the left edge moved', () => {
    const placement = { type: 'wall' as const, wallId: A, offset: inches(6) };
    expect(resizeCommand(SEED_CATALOG, item, inches(36), placement)).toMatchObject({
      type: 'batch',
      commands: [
        { type: 'item.resize', width: inches(36) },
        { type: 'item.move', placement },
      ],
    });
  });

  it('keeps a square corner cabinet square', () => {
    const susan = seedItem('item-000002', 'base.corner.susan', A, 0);
    const command = resizeCommand(SEED_CATALOG, susan, inches(33));
    expect(command).toMatchObject({ width: inches(33), depth: inches(33) });
    expect(() => apply(room(144, 120, susan), command!)).not.toThrow();
  });
});

describe('adding without dragging', () => {
  it('makes an item of the entry at the chosen width', () => {
    const entry = getEntry(SEED_CATALOG, 'base.standard')!;
    expect(newItem(entry, inches(18), 'item-000001')).toMatchObject({
      catalogId: 'base.standard',
      width: inches(18),
      height: inches(34.5),
      depth: inches(24),
    });
  });

  it('finds the first wall with room in the height band', () => {
    const doc = room(60, 60, base('item-000001', 0), base('item-000002', 30));
    const third = base('item-000003', 0);
    // Wall A is full. Wall B is free past the 24 in the cabinet in the corner takes up.
    expect(freeSpot(doc, SEED_CATALOG, third)).toEqual({
      type: 'wall',
      wallId: B,
      offset: inches(24),
    });
    expect(freeSpot(doc, SEED_CATALOG, seedItem('item-000004', 'wall.standard', A, 0))).toEqual({
      type: 'wall',
      wallId: A,
      offset: 0,
    });
  });

  it('stands an item free when there is no wall, if its entry allows that', () => {
    const empty = apply(room(), ...WALLS.map((id) => ({ type: 'wall.remove' as const, id })));
    expect(freeSpot(empty, SEED_CATALOG, base('item-000001', 0))).toEqual({
      type: 'free',
      x: 0,
      y: 0,
      rotation: 0,
    });
    expect(
      freeSpot(empty, SEED_CATALOG, seedItem('item-000002', 'wall.standard', A, 0)),
    ).toBeNull();
  });
});

it('asOne leaves one command alone and batches several', () => {
  const remove = { type: 'item.remove' as const, id: 'item-000001' };
  expect(asOne([], 'x')).toBeNull();
  expect(asOne([remove], 'x')).toBe(remove);
  expect(asOne([remove, remove], 'x')).toEqual({
    type: 'batch',
    commands: [remove, remove],
    label: 'x',
  });
});
