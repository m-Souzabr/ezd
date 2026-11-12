import { describe, expect, it } from 'vitest';

import type { DesignDocument, Item, Opening, Wall } from '../document/index.js';
import { deepFreeze, sampleDocument } from '../test/fixtures.js';
import { inches } from '../units/index.js';
import {
  applyCommand,
  type Command,
  type CommandError,
  COMMAND_TYPES,
  parseCommand,
} from './index.js';

// The sample document is frozen, so every test here also checks that applyCommand does
// not mutate its input.
const doc = sampleDocument();

/** Applies a command that must succeed, then checks its inverse restores the document. */
function apply(from: DesignDocument, cmd: Command) {
  const applied = applyCommand(from, deepFreeze(cmd));
  if (!applied.ok) throw new Error(`${applied.error.code}: ${applied.error.message}`);
  const undone = applyCommand(applied.value.doc, applied.value.inverse);
  if (!undone.ok) throw new Error(`inverse failed: ${undone.error.message}`);
  expect(undone.value.doc).toStrictEqual(from);
  return applied.value;
}

/** Applies a command that must fail with the given code. */
function expectError(from: DesignDocument, cmd: Command, code: CommandError['code']) {
  const result = applyCommand(from, cmd);
  if (result.ok) throw new Error('expected the command to fail');
  expect(result.error.code).toBe(code);
  expect(result.error.message).not.toBe('');
  return result.error;
}

const newWall: Wall = {
  id: 'wall-new-01',
  start: { x: inches(60), y: 0 },
  end: { x: inches(60), y: inches(40) },
  thickness: inches(4.5),
};
const newWindow: Opening = {
  id: 'window-new-01',
  wallId: 'wall-east',
  kind: 'window',
  offset: inches(6),
  width: inches(24),
  height: inches(36),
  sillHeight: inches(42),
};
const newItem: Item = {
  id: 'item-new-01',
  catalogId: 'base-1-door',
  kind: 'base',
  width: inches(18),
  height: inches(34.5),
  depth: inches(24),
  elevation: 0,
  placement: { type: 'wall', wallId: 'wall-north', offset: inches(30) },
  options: {},
};
const ids = (list: readonly { id: string }[]) => list.map((entity) => entity.id);

it('has 14 command types', () => {
  expect(COMMAND_TYPES).toHaveLength(14);
});

describe('schema validation', () => {
  it.each([
    ['an unknown type', { type: 'wall.paint', id: 'wall-north' }],
    ['a missing field', { type: 'wall.remove' }],
    ['an unknown field', { type: 'wall.remove', id: 'wall-north', force: true }],
    ['a float length', { type: 'room.setCeilingHeight', height: 1536.5 }],
    ['a length of zero', { type: 'room.setCeilingHeight', height: 0 }],
    ['a negative length', { type: 'item.resize', id: 'item-base-01', width: -48 }],
    [
      'a rotation of 360',
      {
        type: 'item.move',
        id: 'item-island-01',
        placement: { type: 'free', x: 0, y: 0, rotation: 360 },
      },
    ],
    ['an empty name', { type: 'document.rename', name: '' }],
    ['an invalid id', { type: 'item.remove', id: 'no' }],
    ['not an object', 'wall.remove'],
  ])('rejects %s with SCHEMA', (_label, cmd) => {
    const error = expectError(doc, cmd as Command, 'SCHEMA');
    expect(error.commandIndex).toBeUndefined();
  });

  it('parseCommand returns the command for valid input', () => {
    const cmd = { type: 'wall.remove', id: 'wall-north' };
    expect(parseCommand(cmd)).toEqual({ ok: true, value: cmd });
    expect(parseCommand({ type: 'nope' })).toMatchObject({ ok: false, error: { code: 'SCHEMA' } });
  });
});

describe('room.setCeilingHeight', () => {
  it('sets the height and shares everything else', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'room.setCeilingHeight',
      height: inches(108),
    });
    expect(next.room.ceilingHeight).toBe(inches(108));
    expect(next.room.walls).toBe(doc.room.walls);
    expect(next.items).toBe(doc.items);
    expect(inverse).toEqual({ type: 'room.setCeilingHeight', height: inches(96) });
  });
});

describe('wall.add', () => {
  it('appends a wall', () => {
    const { doc: next, inverse } = apply(doc, { type: 'wall.add', wall: newWall });
    expect(ids(next.room.walls)).toEqual([...ids(doc.room.walls), 'wall-new-01']);
    expect(next.room.walls[0]).toBe(doc.room.walls[0]);
    expect(next.items).toBe(doc.items);
    expect(inverse).toEqual({ type: 'wall.remove', id: 'wall-new-01' });
  });

  it('inserts at an index', () => {
    const { doc: next } = apply(doc, { type: 'wall.add', wall: newWall, index: 1 });
    expect(ids(next.room.walls)[1]).toBe('wall-new-01');
  });

  it('fails with DUPLICATE_ID for an id used by any entity', () => {
    expectError(doc, { type: 'wall.add', wall: { ...newWall, id: 'wall-north' } }, 'DUPLICATE_ID');
    expectError(doc, { type: 'wall.add', wall: { ...newWall, id: 'door-south' } }, 'DUPLICATE_ID');
    expectError(
      doc,
      { type: 'wall.add', wall: { ...newWall, id: 'item-base-01' } },
      'DUPLICATE_ID',
    );
  });

  it('fails with INVALID_ARGUMENT for a zero-length wall or an index past the end', () => {
    expectError(
      doc,
      { type: 'wall.add', wall: { ...newWall, end: newWall.start } },
      'INVALID_ARGUMENT',
    );
    expectError(doc, { type: 'wall.add', wall: newWall, index: 5 }, 'INVALID_ARGUMENT');
  });
});

describe('wall.update', () => {
  it('patches the given fields only', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'wall.update',
      id: 'wall-north',
      patch: { thickness: inches(6), height: inches(84) },
    });
    expect(next.room.walls[0]).toEqual({
      ...doc.room.walls[0],
      thickness: inches(6),
      height: inches(84),
    });
    expect(next.room.walls[1]).toBe(doc.room.walls[1]);
    // The wall had no height of its own, so undoing removes it again.
    expect(inverse).toEqual({
      type: 'wall.update',
      id: 'wall-north',
      patch: { thickness: inches(4.5), height: null },
    });
  });

  it('removes the height with null', () => {
    const withHeight = apply(doc, {
      type: 'wall.update',
      id: 'wall-north',
      patch: { height: inches(84) },
    }).doc;
    const { doc: next } = apply(withHeight, {
      type: 'wall.update',
      id: 'wall-north',
      patch: { height: null },
    });
    expect(next.room.walls[0]).toStrictEqual(doc.room.walls[0]);
  });

  it('fails with NOT_FOUND for an unknown wall', () => {
    expectError(doc, { type: 'wall.update', id: 'wall-missing', patch: {} }, 'NOT_FOUND');
  });

  it('fails with INVALID_ARGUMENT when the wall would have zero length', () => {
    expectError(
      doc,
      { type: 'wall.update', id: 'wall-north', patch: { end: { x: 0, y: 0 } } },
      'INVALID_ARGUMENT',
    );
  });
});

describe('wall.remove', () => {
  // The south wall has the door and no items.
  it('removes the wall and its openings', () => {
    const { doc: next, inverse } = apply(doc, { type: 'wall.remove', id: 'wall-south' });
    expect(ids(next.room.walls)).toEqual(['wall-north', 'wall-east', 'wall-west']);
    expect(ids(next.room.openings)).toEqual(['window-north']);
    expect(inverse).toEqual({
      type: 'batch',
      commands: [
        { type: 'wall.add', wall: doc.room.walls[2], index: 2 },
        { type: 'opening.add', opening: doc.room.openings[0], index: 0 },
      ],
    });
  });

  it('restores several openings to their places among the others', () => {
    const openings = [
      { ...newWindow, id: 'window-a-01', wallId: 'wall-west' },
      { ...newWindow, id: 'window-b-01', wallId: 'wall-south', offset: inches(60) },
      { ...newWindow, id: 'window-c-01', wallId: 'wall-west', offset: inches(48) },
    ];
    const crowded = apply(doc, {
      type: 'batch',
      commands: openings.map((opening, index) => ({ type: 'opening.add', opening, index })),
    }).doc;
    const { doc: next } = apply(crowded, { type: 'wall.remove', id: 'wall-west' });
    expect(ids(next.room.openings)).toEqual(['window-b-01', 'door-south', 'window-north']);
  });

  it('keeps sharing the openings when the wall had none', () => {
    const { doc: next } = apply(doc, { type: 'wall.remove', id: 'wall-west' });
    expect(next.room.openings).toBe(doc.room.openings);
  });

  it('fails with NOT_FOUND for an unknown wall', () => {
    expectError(doc, { type: 'wall.remove', id: 'wall-missing' }, 'NOT_FOUND');
  });

  it('fails with WALL_HAS_ITEMS when an item is placed on the wall', () => {
    const error = expectError(doc, { type: 'wall.remove', id: 'wall-north' }, 'WALL_HAS_ITEMS');
    expect(error.message).toContain('2 item(s)');
  });
});

describe('opening.add', () => {
  it('appends an opening, or inserts at an index', () => {
    const { doc: next, inverse } = apply(doc, { type: 'opening.add', opening: newWindow });
    expect(ids(next.room.openings)).toEqual(['door-south', 'window-north', 'window-new-01']);
    expect(next.room.walls).toBe(doc.room.walls);
    expect(inverse).toEqual({ type: 'opening.remove', id: 'window-new-01' });

    const first = apply(doc, { type: 'opening.add', opening: newWindow, index: 0 }).doc;
    expect(ids(first.room.openings)[0]).toBe('window-new-01');
  });

  it('fails with DUPLICATE_ID for an id in use', () => {
    expectError(
      doc,
      { type: 'opening.add', opening: { ...newWindow, id: 'wall-north' } },
      'DUPLICATE_ID',
    );
  });

  it('fails with NOT_FOUND for an unknown wall', () => {
    expectError(
      doc,
      { type: 'opening.add', opening: { ...newWindow, wallId: 'wall-missing' } },
      'NOT_FOUND',
    );
  });

  it('fails with INVALID_ARGUMENT for a swing on a window, a sill on a door, or a bad index', () => {
    expectError(
      doc,
      { type: 'opening.add', opening: { ...newWindow, swing: 'in-left' } },
      'INVALID_ARGUMENT',
    );
    expectError(
      doc,
      { type: 'opening.add', opening: { ...newWindow, kind: 'door' } },
      'INVALID_ARGUMENT',
    );
    expectError(doc, { type: 'opening.add', opening: newWindow, index: 3 }, 'INVALID_ARGUMENT');
  });
});

describe('opening.update', () => {
  it('patches the given fields only', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'opening.update',
      id: 'window-north',
      patch: { wallId: 'wall-east', offset: inches(20) },
    });
    expect(next.room.openings[1]).toEqual({
      ...doc.room.openings[1],
      wallId: 'wall-east',
      offset: inches(20),
    });
    expect(next.room.openings[0]).toBe(doc.room.openings[0]);
    expect(inverse).toEqual({
      type: 'opening.update',
      id: 'window-north',
      patch: { wallId: 'wall-north', offset: inches(42) },
    });
  });

  it('turns a door into a passage when the swing is removed with it', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'opening.update',
      id: 'door-south',
      patch: { kind: 'passage', swing: null },
    });
    expect(next.room.openings[0]).not.toHaveProperty('swing');
    expect(inverse).toMatchObject({ patch: { kind: 'door', swing: 'in-left' } });
  });

  it('fails with NOT_FOUND for an unknown opening or wall', () => {
    expectError(doc, { type: 'opening.update', id: 'door-missing', patch: {} }, 'NOT_FOUND');
    expectError(
      doc,
      { type: 'opening.update', id: 'door-south', patch: { wallId: 'wall-missing' } },
      'NOT_FOUND',
    );
  });

  it('fails with INVALID_ARGUMENT when the result is not a consistent opening', () => {
    // The door keeps its swing, which a passage cannot have.
    expectError(
      doc,
      { type: 'opening.update', id: 'door-south', patch: { kind: 'passage' } },
      'INVALID_ARGUMENT',
    );
    expectError(
      doc,
      { type: 'opening.update', id: 'door-south', patch: { sillHeight: inches(2) } },
      'INVALID_ARGUMENT',
    );
  });
});

describe('opening.remove', () => {
  it('removes the opening', () => {
    const { doc: next, inverse } = apply(doc, { type: 'opening.remove', id: 'door-south' });
    expect(ids(next.room.openings)).toEqual(['window-north']);
    expect(inverse).toEqual({ type: 'opening.add', opening: doc.room.openings[0], index: 0 });
  });

  it('fails with NOT_FOUND for an unknown opening', () => {
    expectError(doc, { type: 'opening.remove', id: 'door-missing' }, 'NOT_FOUND');
  });
});

describe('item.add', () => {
  it('appends an item, or inserts at an index', () => {
    const { doc: next, inverse } = apply(doc, { type: 'item.add', item: newItem });
    expect(ids(next.items)).toEqual([...ids(doc.items), 'item-new-01']);
    expect(next.room).toBe(doc.room);
    expect(inverse).toEqual({ type: 'item.remove', id: 'item-new-01' });

    const second = apply(doc, { type: 'item.add', item: newItem, index: 1 }).doc;
    expect(ids(second.items)[1]).toBe('item-new-01');
  });

  it('accepts a free placement', () => {
    const island: Item = { ...newItem, placement: { type: 'free', x: 0, y: 0, rotation: 45 } };
    expect(apply(doc, { type: 'item.add', item: island }).doc.items.at(-1)).toEqual(island);
  });

  it('does not check the catalog or collisions', () => {
    // Same place as an existing item, and a catalog id nothing defines.
    const clash: Item = {
      ...newItem,
      catalogId: 'no-such-cabinet',
      placement: { type: 'wall', wallId: 'wall-north', offset: 0 },
    };
    apply(doc, { type: 'item.add', item: clash });
  });

  it('fails with DUPLICATE_ID for an id in use', () => {
    expectError(
      doc,
      { type: 'item.add', item: { ...newItem, id: 'item-base-01' } },
      'DUPLICATE_ID',
    );
  });

  it('fails with NOT_FOUND for an unknown wall', () => {
    expectError(
      doc,
      {
        type: 'item.add',
        item: { ...newItem, placement: { type: 'wall', wallId: 'wall-missing', offset: 0 } },
      },
      'NOT_FOUND',
    );
  });

  it('fails with INVALID_ARGUMENT for an index past the end', () => {
    expectError(doc, { type: 'item.add', item: newItem, index: 5 }, 'INVALID_ARGUMENT');
  });
});

describe('item.move', () => {
  it('moves an item to another wall', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.move',
      id: 'item-base-01',
      placement: { type: 'wall', wallId: 'wall-west', offset: inches(12) },
    });
    expect(next.items[0]).toEqual({
      ...doc.items[0],
      placement: { type: 'wall', wallId: 'wall-west', offset: inches(12) },
    });
    expect(next.items[1]).toBe(doc.items[1]);
    expect(next.room).toBe(doc.room);
    expect(inverse).toEqual({
      type: 'item.move',
      id: 'item-base-01',
      placement: doc.items[0]!.placement,
    });
  });

  it('moves an item off its wall and changes its elevation', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.move',
      id: 'item-wall-01',
      placement: { type: 'free', x: inches(50), y: inches(50), rotation: 270 },
      elevation: inches(60),
    });
    expect(next.items[1]).toMatchObject({
      placement: { type: 'free', rotation: 270 },
      elevation: inches(60),
    });
    expect(inverse).toMatchObject({ elevation: inches(54) });
  });

  it('fails with NOT_FOUND for an unknown item or wall', () => {
    const placement = { type: 'wall', wallId: 'wall-north', offset: 0 } as const;
    expectError(doc, { type: 'item.move', id: 'item-missing', placement }, 'NOT_FOUND');
    expectError(
      doc,
      {
        type: 'item.move',
        id: 'item-base-01',
        placement: { ...placement, wallId: 'wall-missing' },
      },
      'NOT_FOUND',
    );
  });
});

describe('item.resize', () => {
  it('changes the given dimensions only', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.resize',
      id: 'item-base-01',
      width: inches(36),
      depth: inches(21),
    });
    expect(next.items[0]).toEqual({ ...doc.items[0], width: inches(36), depth: inches(21) });
    expect(inverse).toEqual({
      type: 'item.resize',
      id: 'item-base-01',
      width: inches(30),
      depth: inches(24),
    });
  });

  it('treats a field that is present but undefined as omitted', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.resize',
      id: 'item-base-01',
      width: undefined,
      depth: inches(21),
    });
    expect(next.items[0]).toStrictEqual({ ...doc.items[0], depth: inches(21) });
    expect(inverse).toStrictEqual({ type: 'item.resize', id: 'item-base-01', depth: inches(24) });
  });

  it('does not apply cabinet size rules', () => {
    apply(doc, { type: 'item.resize', id: 'item-base-01', width: inches(31.0625) });
  });

  it('fails with NOT_FOUND for an unknown item', () => {
    expectError(doc, { type: 'item.resize', id: 'item-missing', width: inches(36) }, 'NOT_FOUND');
  });
});

describe('item.setOptions', () => {
  it('merges into the options and leaves the finish alone', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.setOptions',
      id: 'item-base-01',
      options: { doors: 1, hinge: 'left' },
    });
    expect(next.items[0]).toEqual({
      ...doc.items[0],
      options: { doors: 1, softClose: true, hinge: 'left' },
    });
    expect(inverse).toEqual({
      type: 'item.setOptions',
      id: 'item-base-01',
      options: { doors: 2, hinge: null },
    });
  });

  it('removes an option with null, and keeps false, 0 and empty text as values', () => {
    const { doc: next, inverse } = apply(doc, {
      type: 'item.setOptions',
      id: 'item-base-01',
      options: { softClose: null, doors: 0, note: '', glass: false },
    });
    expect(next.items[0]!.options).toStrictEqual({ doors: 0, note: '', glass: false });
    const undone = apply(next, inverse).doc;
    apply(undone, { type: 'item.setOptions', id: 'item-base-01', options: { missing: null } });
  });

  it('sets and removes the finish', () => {
    const set = apply(doc, {
      type: 'item.setOptions',
      id: 'item-wall-01',
      options: {},
      finishId: 'oak',
    });
    expect(set.doc.items[1]!.finishId).toBe('oak');
    expect(set.inverse).toEqual({
      type: 'item.setOptions',
      id: 'item-wall-01',
      options: {},
      finishId: null,
    });

    const removed = apply(doc, {
      type: 'item.setOptions',
      id: 'item-base-01',
      options: {},
      finishId: null,
    });
    expect(removed.doc.items[0]).not.toHaveProperty('finishId');
    expect(removed.inverse).toMatchObject({ finishId: 'white-shaker' });
  });

  it('fails with NOT_FOUND for an unknown item', () => {
    expectError(doc, { type: 'item.setOptions', id: 'item-missing', options: {} }, 'NOT_FOUND');
  });
});

describe('item.remove', () => {
  it('removes the item', () => {
    const { doc: next, inverse } = apply(doc, { type: 'item.remove', id: 'item-wall-01' });
    expect(ids(next.items)).toEqual(['item-base-01', 'item-tall-01', 'item-island-01']);
    expect(inverse).toEqual({ type: 'item.add', item: doc.items[1], index: 1 });
  });

  it('fails with NOT_FOUND for an unknown item', () => {
    expectError(doc, { type: 'item.remove', id: 'item-missing' }, 'NOT_FOUND');
  });
});

describe('document.rename', () => {
  it('renames the document', () => {
    const { doc: next, inverse } = apply(doc, { type: 'document.rename', name: 'Galley' });
    expect(next.name).toBe('Galley');
    expect(next.room).toBe(doc.room);
    expect(inverse).toEqual({ type: 'document.rename', name: 'Sample kitchen' });
  });
});

describe('batch', () => {
  const clearNorthWall: Command = {
    type: 'batch',
    label: 'Remove the north wall',
    commands: [
      { type: 'item.remove', id: 'item-base-01' },
      { type: 'item.remove', id: 'item-wall-01' },
      { type: 'wall.remove', id: 'wall-north' },
    ],
  };

  it('applies each command to the result of the one before', () => {
    const { doc: next, inverse } = apply(doc, clearNorthWall);
    expect(ids(next.room.walls)).toEqual(['wall-east', 'wall-south', 'wall-west']);
    expect(ids(next.items)).toEqual(['item-tall-01', 'item-island-01']);
    expect(ids(next.room.openings)).toEqual(['door-south']);
    // Inverses in reverse order, under the same label.
    expect(inverse).toMatchObject({
      type: 'batch',
      label: 'Remove the north wall',
      commands: [{ type: 'batch' }, { type: 'item.add' }, { type: 'item.add' }],
    });
  });

  it('accepts an empty batch and nested batches', () => {
    expect(apply(doc, { type: 'batch', commands: [] }).doc).toBe(doc);
    const { doc: next } = apply(doc, {
      type: 'batch',
      commands: [{ type: 'document.rename', name: 'Outer' }, clearNorthWall],
    });
    expect(next.name).toBe('Outer');
    expect(next.room.walls).toHaveLength(3);
  });

  it('applies nothing when a command fails, and reports its index', () => {
    const error = expectError(
      doc,
      {
        type: 'batch',
        commands: [
          { type: 'document.rename', name: 'Renamed' },
          { type: 'item.remove', id: 'item-base-01' },
          { type: 'wall.remove', id: 'wall-north' },
        ],
      },
      'WALL_HAS_ITEMS',
    );
    expect(error.commandIndex).toBe(2);
    expect(doc.name).toBe('Sample kitchen');
    expect(doc.items).toHaveLength(4);
  });

  it('reports the outer index when a nested batch fails', () => {
    const error = expectError(
      doc,
      {
        type: 'batch',
        commands: [
          { type: 'document.rename', name: 'Renamed' },
          { type: 'batch', commands: [{ type: 'item.remove', id: 'item-missing' }] },
        ],
      },
      'NOT_FOUND',
    );
    expect(error.commandIndex).toBe(1);
  });

  it('reports the index of a command that fails its schema', () => {
    const error = expectError(
      doc,
      {
        type: 'batch',
        commands: [
          { type: 'document.rename', name: 'Renamed' },
          { type: 'room.setCeilingHeight', height: 0.5 },
        ],
      },
      'SCHEMA',
    );
    expect(error.commandIndex).toBe(1);
  });

  it('fails with SCHEMA, and no index, when the batch itself is malformed', () => {
    const error = expectError(doc, { type: 'batch' } as unknown as Command, 'SCHEMA');
    expect(error.commandIndex).toBeUndefined();
  });
});
