import {
  applyCommand,
  type Command,
  type DesignDocument,
  inches,
  itemFootprint,
  pointInWallFrame,
  SEED_CATALOG,
} from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { apply, room, seedItem, WALLS } from '../../test/kitchen';
import { openingCommand } from '../tools/opening';
import { elevationItemAt, elevationModel } from './model';

const [A, B] = WALLS;
const model = (doc: DesignDocument, wallId: string = A) => {
  const built = elevationModel(doc, SEED_CATALOG, wallId);
  if (!built) throw new Error('no such wall');
  return built;
};

const kitchen = () =>
  room(
    144,
    120,
    seedItem('item-base01', 'base.standard', A, 12),
    seedItem('item-wall01', 'wall.standard', A, 12),
    seedItem('item-tall01', 'tall.pantry', A, 60),
    seedItem('item-sink01', 'base.sink', B, 0),
  );

describe('elevationModel', () => {
  it('has the wall outline, floor at 0 and ceiling at the wall height', () => {
    expect(model(kitchen())).toMatchObject({ wallId: A, length: inches(144), height: inches(96) });
    expect(elevationModel(kitchen(), SEED_CATALOG, 'wall-missing')).toBeNull();
  });

  it('places each item at its offset and elevation', () => {
    const rects = Object.fromEntries(model(kitchen()).items.map(({ id, rect }) => [id, rect]));
    expect(rects).toEqual({
      'item-base01': { x: inches(12), y: 0, w: inches(30), h: inches(34.5) },
      'item-wall01': { x: inches(12), y: inches(54), w: inches(30), h: inches(30) },
      'item-tall01': { x: inches(60), y: 0, w: inches(24), h: inches(84) },
    });
  });

  it('draws the fronts from generateParts inside the item', () => {
    const base = model(kitchen()).items.find(({ id }) => id === 'item-base01')!;
    expect(base.code).toBe('B30');
    expect(base.fronts.map((front) => front.role).sort()).toEqual([
      'door',
      'door',
      'drawer-front',
      'toe-kick',
    ]);
    for (const { rect } of base.fronts) {
      expect(rect.x).toBeGreaterThanOrEqual(base.rect.x);
      expect(rect.x + rect.w).toBeLessThanOrEqual(base.rect.x + base.rect.w);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(base.rect.h);
    }
    expect(base.fronts.find((front) => front.role === 'toe-kick')!.rect).toEqual({
      x: inches(12),
      y: 0,
      w: inches(30),
      h: inches(4.5),
    });
  });

  it('shows an item on the next wall that reaches this one in the corner', () => {
    // The sink base at the start of wall B is 24 in deep, so it covers the end of wall A.
    expect(model(kitchen()).adjacent).toEqual([
      { id: 'item-sink01', rect: { x: inches(120), y: 0, w: inches(24), h: inches(34.5) } },
    ]);
  });

  it('draws openings at their sill height', () => {
    const empty = room();
    const doc = apply(
      empty,
      openingCommand(empty.room.walls[0]!, 'window', inches(60), () => 'opening-win01'),
    );
    expect(model(doc).openings).toEqual([
      {
        id: 'opening-win01',
        kind: 'window',
        rect: { x: inches(42), y: inches(36), w: inches(36), h: inches(48) },
      },
    ]);
  });

  it('draws a countertop as a 1.5 in band with an 18 in backsplash zone above it', () => {
    const doc = apply(kitchen(), {
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
    });
    const built = model(doc);
    expect(built.countertops).toEqual([
      {
        id: 'countertop-01',
        rect: { x: inches(12), y: inches(34.5), w: inches(30), h: inches(1.5) },
      },
    ]);
    expect(built.backsplash).toEqual([
      { x: inches(12), y: inches(36), w: inches(30), h: inches(18) },
    ]);
  });

  it('dimensions floor-standing items along the bottom and hung items along the top', () => {
    const { dimensions } = model(kitchen());
    expect(dimensions.bottom.map(({ kind, text }) => `${kind} ${text}`)).toEqual([
      'gap 12"',
      'item 30"',
      'gap 18"',
      'item 24"',
      'gap 60"',
    ]);
    expect(dimensions.top.map(({ text }) => text)).toEqual(['12"', '30"', '102"']);
    expect(dimensions.bottom.at(-1)).toMatchObject({ from: inches(84), to: inches(144) });
  });

  it('spans the wall along the bottom when it is empty, and has no top string', () => {
    expect(model(room()).dimensions).toEqual({
      bottom: [{ from: 0, to: inches(144), text: '144"', kind: 'gap' }],
      top: [],
    });
  });

  it('finds the item under a point, the shallower one in front', () => {
    const built = model(kitchen());
    expect(elevationItemAt(built, inches(20), inches(10))?.id).toBe('item-base01');
    expect(elevationItemAt(built, inches(20), inches(60))?.id).toBe('item-wall01');
    expect(elevationItemAt(built, inches(50), inches(10))).toBeNull();
  });
});

describe('the elevation matches the plan', () => {
  /** What the plan draws on a wall: where each footprint sits along it. */
  function planSpans(doc: DesignDocument, wallId: string) {
    const wall = doc.room.walls.find((candidate) => candidate.id === wallId)!;
    return doc.items
      .filter((item) => item.placement.type === 'wall' && item.placement.wallId === wallId)
      .map((item) => {
        const along = itemFootprint(doc, item)!.map((p) => pointInWallFrame(wall, p).along);
        return { id: item.id, start: Math.min(...along), end: Math.max(...along) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  const elevationSpans = (doc: DesignDocument, wallId: string) =>
    model(doc, wallId)
      .items.map(({ id, rect }) => ({ id, start: rect.x, end: rect.x + rect.w }))
      .sort((a, b) => a.id.localeCompare(b.id));

  const edits: Command[] = [
    {
      type: 'item.add',
      item: seedItem('item-new001', 'base.drawers', A, 90),
    },
    {
      type: 'item.move',
      id: 'item-base01',
      placement: { type: 'wall', wallId: A, offset: inches(27) },
    },
    { type: 'item.resize', id: 'item-wall01', width: inches(36), height: inches(42) },
    {
      type: 'item.move',
      id: 'item-tall01',
      placement: { type: 'wall', wallId: B, offset: inches(48) },
    },
    { type: 'item.remove', id: 'item-base01' },
    {
      type: 'item.move',
      id: 'item-sink01',
      placement: { type: 'free', x: inches(40), y: inches(60), rotation: 0 },
    },
  ];

  it('for every wall, after each edit', () => {
    let doc = kitchen();
    for (const command of edits) {
      const applied = applyCommand(doc, command, { catalog: SEED_CATALOG });
      if (!applied.ok) throw new Error(applied.error.message);
      doc = applied.value.doc;
      for (const wall of doc.room.walls) {
        const plan = planSpans(doc, wall.id);
        const elevation = elevationSpans(doc, wall.id);
        expect(elevation.map(({ id }) => id)).toEqual(plan.map(({ id }) => id));
        elevation.forEach((span, i) => {
          expect(span.start).toBeCloseTo(plan[i]!.start, 6);
          expect(span.end).toBeCloseTo(plan[i]!.end, 6);
        });
      }
    }
    // The pantry moved to wall B and the sink base off the walls altogether.
    expect(elevationSpans(doc, A).map(({ id }) => id)).toEqual(['item-new001', 'item-wall01']);
    expect(elevationSpans(doc, B).map(({ id }) => id)).toEqual(['item-tall01']);
  });
});
