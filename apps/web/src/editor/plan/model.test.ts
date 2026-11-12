import { createEmptyDocument, inches } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { apply, countingIds, room, seedItem, WALLS } from '../../test/kitchen';
import { openingCommand } from '../tools/opening';
import { roomCommand } from '../tools/wall';
import { itemDimensions, openingSymbol, wallDimensions, wallPolygon } from './model';

const [A, B] = WALLS;
const at = (x: number, y: number) => ({ x: inches(x), y: inches(y) });
const base = (id: string, offset: number) => seedItem(id, 'base.standard', A, offset);

describe('wallPolygon', () => {
  it('draws the thickness outside the room and fills the outside corners', () => {
    const doc = room(120, 96);
    // Wall A runs along the top. Its outer edge reaches past both ends by the thickness.
    expect(wallPolygon(doc, doc.room.walls[0]!)).toEqual([
      at(0, 0),
      at(120, 0),
      at(124.5, -4.5),
      at(-4.5, -4.5),
    ]);
  });

  it('mitres an inside corner the other way', () => {
    const l = roomCommand(
      'l',
      { width: inches(144), depth: inches(120), notchWidth: inches(48), notchDepth: inches(36) },
      countingIds(),
    );
    if (!l.ok) throw new Error(l.error);
    const doc = apply(createEmptyDocument({ id: 'design-test01', name: 'L' }), l.value);
    // The third wall runs left along y = 84 from x = 144 to the inside corner at x = 96.
    const [start, end, outerEnd, outerStart] = wallPolygon(doc, doc.room.walls[2]!);
    expect([start, end]).toEqual([at(144, 84), at(96, 84)]);
    // The outer faces meet past the outside corner, and short of the wall's end inside.
    expect(outerStart).toEqual(at(148.5, 88.5));
    expect(outerEnd).toEqual(at(100.5, 88.5));
  });

  it('ends a wall square where no other wall meets it', () => {
    const doc = apply(room(120, 96), { type: 'wall.remove', id: B });
    const [, , outerEnd] = wallPolygon(doc, doc.room.walls[0]!);
    expect(outerEnd).toEqual(at(120, -4.5));
  });
});

describe('dimensions', () => {
  it('labels every wall with its letter and length in inches', () => {
    const doc = room(120, 96.5);
    expect(wallDimensions(doc).map((dimension) => dimension.text)).toEqual([
      'A  120"',
      'B  96 1/2"',
      'C  120"',
      'D  96 1/2"',
    ]);
    // Drawn outside the wall, pushed away from the room.
    expect(wallDimensions(doc)[0]).toMatchObject({
      from: at(0, -4.5),
      to: at(120, -4.5),
      away: { x: 0, y: -1 },
    });
  });

  it('gives the selected item its width and the gaps to its neighbours', () => {
    const doc = room(144, 120, base('item-000001', 12), base('item-000002', 51.5));
    const [first, second] = doc.items;
    expect(itemDimensions(doc, first!).map(({ kind, text }) => [kind, text])).toEqual([
      ['gap', '12"'],
      ['width', '30"'],
      ['gap', '9 1/2"'],
    ]);
    expect(itemDimensions(doc, second!).map(({ text }) => text)).toEqual([
      '9 1/2"',
      '30"',
      '62 1/2"',
    ]);
    // Along the front of the item, 24 in from the wall.
    expect(itemDimensions(doc, first!)[1]).toMatchObject({ from: at(12, 24), to: at(42, 24) });
  });

  it('leaves out a gap of nothing, and measures to an opening', () => {
    const flush = room(144, 120, base('item-000001', 0), base('item-000002', 30));
    expect(itemDimensions(flush, flush.items[0]!).map(({ text }) => text)).toEqual(['30"']);

    const empty = room(144, 120, base('item-000001', 12));
    const doc = apply(
      empty,
      openingCommand(empty.room.walls[0]!, 'door', inches(100), () => 'opening-door1'),
    );
    expect(itemDimensions(doc, doc.items[0]!).map(({ text }) => text)).toEqual([
      '12"',
      '30"',
      '42"',
    ]);
  });

  it('ignores items in another height band', () => {
    const doc = room(
      144,
      120,
      base('item-000001', 12),
      seedItem('item-000002', 'wall.standard', A, 48),
    );
    expect(itemDimensions(doc, doc.items[0]!).map(({ text }) => text)).toEqual([
      '12"',
      '30"',
      '102"',
    ]);
  });

  it('gives a free-standing item only its width', () => {
    const island = {
      ...base('item-000001', 0),
      placement: { type: 'free' as const, x: inches(48), y: inches(60), rotation: 0 },
    };
    expect(itemDimensions(room(144, 120, island), island)).toMatchObject([
      { kind: 'width', text: '30"', from: at(48, 84), to: at(78, 84), away: { x: 0, y: 1 } },
    ]);
  });
});

describe('openingSymbol', () => {
  const doc = room(144, 120);
  const wall = doc.room.walls[0]!;
  const door = (swing: 'in-left' | 'in-right' | 'out-left') => ({
    id: 'opening-door1',
    wallId: A,
    kind: 'door' as const,
    offset: inches(48),
    width: inches(32),
    height: inches(80),
    sillHeight: 0,
    swing,
  });

  it('cuts a gap through the wall', () => {
    expect(openingSymbol(wall, door('in-left')).gap).toEqual([
      at(48, 0),
      at(80, 0),
      at(80, -4.5),
      at(48, -4.5),
    ]);
  });

  it('hinges a door on the left or right and swings it into the room', () => {
    expect(openingSymbol(wall, door('in-left')).swing).toEqual({
      hinge: at(48, 0),
      closed: at(80, 0),
      open: at(48, 32),
      radius: inches(32),
    });
    expect(openingSymbol(wall, door('in-right')).swing).toMatchObject({
      hinge: at(80, 0),
      closed: at(48, 0),
      open: at(80, 32),
    });
  });

  it('swings a door out from the outer face of the wall', () => {
    expect(openingSymbol(wall, door('out-left')).swing).toMatchObject({
      hinge: at(48, -4.5),
      closed: at(80, -4.5),
      open: at(48, -36.5),
    });
  });

  it('has no swing for a window', () => {
    const { swing, ...window } = door('in-left');
    expect(swing).toBeDefined();
    expect(openingSymbol(wall, { ...window, kind: 'window' }).swing).toBeUndefined();
  });
});
