import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defaultItemFor, getEntry, SEED_CATALOG } from '../catalog/index.js';
import {
  type DesignDocument,
  type Item,
  type Placement,
  PlacementSchema,
} from '../document/index.js';
import { clone } from '../test/fixtures.js';
import { door, free, kitchen, on } from '../test/kitchen.js';
import { inches, isLen, STEP } from '../units/index.js';
import { snap, snapResize, type SnapResult } from './index.js';

const catalog = SEED_CATALOG;

/** A new item of a seed entry, as it comes off the palette. */
const fresh = (catalogId: string, overrides: Partial<Item> = {}): Item => ({
  ...defaultItemFor(getEntry(catalog, catalogId)!, 'item-new-0001'),
  ...overrides,
});

/** Drags a new item to a pointer given in inches. */
const drop = (doc: DesignDocument, item: Item, x: number, y: number): SnapResult =>
  snap({ doc, catalog, item, pointer: { x: x * 16, y: y * 16 } });

const onWall = (wallId: string, offset: number): Placement => ({
  type: 'wall',
  wallId,
  offset: inches(offset),
});

// A 30 in base cabinet dragged along the north wall has its middle 15 in past its offset.
const base = fresh('base.standard');

describe('snap on a wall', () => {
  const doc = kitchen([on('base.standard', 'wall-north', 30)]);

  it('goes flush against a neighbour when the pointer is near its edge', () => {
    const right = drop(doc, base, 76, 10);
    expect(right.placement).toEqual(onWall('wall-north', 60));
    expect(right.guides).toEqual([
      { kind: 'edge', from: { x: inches(60), y: 0 }, to: { x: inches(60), y: inches(24) } },
    ]);
    // And on the other side, where only a 30 in cabinet fits between it and the corner.
    const left = drop(doc, base, 16.2, 10);
    expect(left.placement).toEqual(onWall('wall-north', 0));
    expect(left.guides.map((guide) => [guide.kind, guide.from.x])).toEqual([
      ['wall-end', 0],
      ['edge', inches(30)],
    ]);
  });

  it('goes to the wall end when the pointer is near it', () => {
    const result = drop(doc, base, 128, 6);
    expect(result.placement).toEqual(onWall('wall-north', 114));
    expect(result.guides).toEqual([
      { kind: 'wall-end', from: { x: inches(144), y: 0 }, to: { x: inches(144), y: inches(24) } },
    ]);
  });

  it('lands on a 3 in multiple in the middle of the wall', () => {
    const result = drop(doc, base, 100.7, 6);
    expect(result.placement).toEqual(onWall('wall-north', 87));
    expect(result.guides).toEqual([
      { kind: 'grid', from: { x: inches(87), y: 0 }, to: { x: inches(87), y: inches(24) } },
    ]);
    expect(result.placement.type === 'wall' && result.placement.offset % STEP).toBe(0);
  });

  it('prefers an edge off the grid to the grid', () => {
    const offGrid = kitchen([on('base.standard', 'wall-north', 31)]);
    expect(drop(offGrid, base, 77.4, 6).placement).toEqual(onWall('wall-north', 61));
    // Too far from the edge, so the grid it is.
    expect(drop(offGrid, base, 79, 6).placement).toEqual(onWall('wall-north', 63));
  });

  it('picks the nearest of several edges, and the first of two at the same distance', () => {
    const two = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 61),
    ]);
    expect(drop(two, base, 45.4, 6).placement).toEqual(onWall('wall-north', 30));
    expect(drop(two, base, 45.6, 6).placement).toEqual(onWall('wall-north', 31));
    expect(drop(two, base, 45.5, 6).placement).toEqual(onWall('wall-north', 30));
  });

  it('clamps the offset to the wall', () => {
    const alone = kitchen([], { walls: 1 });
    expect(drop(alone, base, 150, 5).placement).toEqual(onWall('wall-north', 114));
    expect(drop(alone, base, -5, 5).placement).toEqual(onWall('wall-north', 0));
    // Wider than the wall: it starts at the wall start.
    const narrow = kitchen([], { width: 24 });
    expect(drop(narrow, base, 12, 5).placement).toEqual(onWall('wall-north', 0));
  });

  it('snaps to the edges of an opening', () => {
    const withDoor = kitchen([], { openings: [door('wall-north', 42, 32)] });
    const result = drop(withDoor, base, 90, 6);
    expect(result.placement).toEqual(onWall('wall-north', 74));
    expect(result.guides.map((guide) => guide.kind)).toEqual(['opening']);
    expect(drop(withDoor, base, 26, 6).placement).toEqual(onWall('wall-north', 12));
  });

  it('snaps only to neighbours in the same height band', () => {
    const offGrid = kitchen([on('base.standard', 'wall-north', 31)]);
    const cabinet = fresh('wall.standard');
    expect(drop(offGrid, cabinet, 76.2, 6).placement).toEqual(onWall('wall-north', 60));
    expect(drop(offGrid, base, 76.2, 6).placement).toEqual(onWall('wall-north', 61));
  });

  it('goes flush against a cabinet that comes round the corner', () => {
    const corner = kitchen([on('base.standard', 'wall-north', 114)]);
    const result = drop(corner, base, 138, 40);
    expect(result.placement).toEqual(onWall('wall-east', 24));
    expect(result.guides).toEqual([
      {
        kind: 'edge',
        from: { x: inches(144), y: inches(24) },
        to: { x: inches(120), y: inches(24) },
      },
    ]);
    expect(result.introduced.filter((violation) => violation.severity === 'error')).toEqual([]);
  });

  it('takes the nearest wall within the capture distance', () => {
    expect(drop(doc, base, 138, 100).placement).toEqual(onWall('wall-east', 84));
    expect(drop(doc, base, 60, 115).placement).toEqual(onWall('wall-south', 69));
    // In the corner, the nearer wall wins.
    expect(drop(doc, base, 140, 8).placement).toMatchObject({ wallId: 'wall-east' });
    expect(drop(doc, base, 136, 4).placement).toMatchObject({ wallId: 'wall-north' });
  });

  it('honours the options', () => {
    const result = snap({
      doc,
      catalog,
      item: base,
      pointer: { x: 100.7 * 16, y: 20 * 16 },
      options: { grid: inches(1), wallCaptureDistance: inches(24), edgeSnapDistance: inches(0.25) },
    });
    expect(result.placement).toEqual(onWall('wall-north', 86));
    expect(drop(doc, base, 100.7, 20).placement.type).toBe('free');
  });
});

describe('snap in the open', () => {
  const doc = kitchen();

  it('places an island free on the grid when the pointer is far from every wall', () => {
    const result = drop(doc, base, 72, 60);
    expect(result.placement).toEqual({ type: 'free', x: inches(57), y: inches(48), rotation: 0 });
    expect(result.guides).toEqual([
      {
        kind: 'grid',
        from: { x: inches(57), y: inches(48) },
        to: { x: inches(87), y: inches(48) },
      },
    ]);
  });

  it('keeps a wall cabinet on the nearest wall however far the pointer is', () => {
    const result = drop(doc, fresh('wall.standard'), 72, 50);
    expect(result.placement).toEqual(onWall('wall-north', 57));
  });

  it('snaps the rotation an item already has to the rotation step', () => {
    const turned = (rotation: number) =>
      drop(doc, { ...base, placement: { type: 'free', x: 0, y: 0, rotation } }, 72, 60).placement;
    expect(turned(100)).toEqual({ type: 'free', x: inches(84), y: inches(45), rotation: 90 });
    expect(turned(350)).toMatchObject({ rotation: 0 });
    expect(turned(200)).toMatchObject({ rotation: 180 });
    const fine = snap({
      doc,
      catalog,
      item: { ...base, placement: { type: 'free', x: 0, y: 0, rotation: 50 } },
      pointer: { x: inches(72), y: inches(60) },
      options: { freeRotationStep: 45 },
    });
    expect(fine.placement).toMatchObject({ rotation: 45 });
    expect(
      fine.placement.type === 'free' && [fine.placement.x, fine.placement.y].every(isLen),
    ).toBe(true);
  });

  it('never returns a negative zero', () => {
    const result = drop(doc, base, 15, 12.01);
    expect(result.placement.type).toBe('free');
    expect(Object.is(result.placement.type === 'free' && result.placement.y, 0)).toBe(true);
  });

  it('leaves an item that only goes on walls where it is when there are none', () => {
    const empty = kitchen([], { walls: 0 });
    const cabinet = fresh('wall.standard', { placement: onWall('wall-gone', 12) });
    const result = drop(empty, cabinet, 72, 60);
    expect(result.placement).toEqual(onWall('wall-gone', 12));
    expect(result.guides).toEqual([]);
    expect(result.introduced).toEqual([]);
    expect(drop(empty, base, 72, 60).placement.type).toBe('free');
  });
});

describe('snap elevation and violations', () => {
  const doc = kitchen(
    [on('base.standard', 'wall-north', 30), on('wall.standard', 'wall-east', 30)],
    {
      openings: [door('wall-north', 90, 32)],
    },
  );

  it("gives a new item its entry's default elevation", () => {
    const cabinet = fresh('wall.standard', { elevation: inches(10) });
    expect(drop(doc, cabinet, 20, 5).elevation).toBe(inches(54));
    expect(drop(doc, base, 20, 5).elevation).toBe(0);
  });

  it('keeps the elevation of an item being moved, and does not snap it to itself', () => {
    const item = { ...doc.items[1]!, elevation: inches(60) };
    const raised = clone(doc) as DesignDocument;
    raised.items[1] = item;
    const result = snap({
      doc: raised,
      catalog,
      item,
      pointer: { x: 140 * 16, y: 46.2 * 16 },
      excludeItemId: item.id,
    });
    expect(result.elevation).toBe(inches(60));
    // Its own edge at 30 in is not a candidate, so it lands on the grid.
    expect(result.placement).toEqual(onWall('wall-east', 30));
    expect(result.introduced).toEqual([]);
  });

  it('reports what dropping the item here would introduce', () => {
    const blocked = drop(doc, base, 100, 5);
    expect(blocked.placement).toEqual(onWall('wall-north', 84));
    expect(blocked.introduced.map((violation) => violation.ruleId)).toContain('item.blocks-door');
    const clear = drop(doc, base, 75, 5);
    expect(clear.placement).toEqual(onWall('wall-north', 60));
    expect(clear.introduced.filter((violation) => violation.severity !== 'info')).toEqual([]);
  });

  it('reports what moving an item would introduce', () => {
    const item = doc.items[0]!;
    const result = snap({
      doc,
      catalog,
      item,
      pointer: { x: inches(107), y: inches(5) },
      excludeItemId: item.id,
    });
    expect(result.placement).toEqual(onWall('wall-north', 93));
    expect(result.introduced.map((violation) => violation.ruleId)).toContain('item.blocks-door');
  });

  it('places an item the catalog does not know anywhere, at its own elevation', () => {
    const unknown = fresh('base.standard', { catalogId: 'nope', elevation: inches(7) });
    const near = drop(doc, unknown, 20, 5);
    expect(near.placement).toEqual(onWall('wall-north', 6));
    expect(near.elevation).toBe(inches(7));
    // The catalog rejects the item, so there is nothing to say about dropping it.
    expect(near.introduced).toEqual([]);
    expect(drop(doc, unknown, 72, 60).placement.type).toBe('free');
  });
});

describe('snap properties', () => {
  const doc = kitchen(
    [
      on('base.standard', 'wall-north', 31),
      on('wall.standard', 'wall-north', 64),
      on('tall.pantry', 'wall-east', 13.5),
      on('base.standard', 'wall-south', 114),
      free('base.drawers', 50, 50, 30),
    ],
    { openings: [door('wall-south', 20, 32, 'in-left'), door('wall-west', 40, 30)] },
  );
  const lengths = new Map(
    doc.room.walls.map((wall) => [wall.id, wall.id.match(/north|south/) ? 144 : 120]),
  );

  it('always returns a schema-valid placement of integer lengths, inside the wall', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...catalog.entries),
        fc.double({ min: -3000, max: 5000, noNaN: true }),
        fc.double({ min: -3000, max: 5000, noNaN: true }),
        fc.integer({ min: 0, max: 359 }),
        fc.boolean(),
        (entry, x, y, rotation, free) => {
          const item = defaultItemFor(
            entry,
            'item-new-0001',
            free ? { type: 'free', x: 0, y: 0, rotation } : onWall('wall-north', 0),
          );
          const result = snap({ doc, catalog, item, pointer: { x, y } });
          const { placement } = result;
          expect(PlacementSchema.safeParse(placement).success).toBe(true);
          expect(isLen(result.elevation)).toBe(true);
          expect(entry.placement).toContain(placement.type);
          if (placement.type === 'wall') {
            expect(isLen(placement.offset)).toBe(true);
            expect(placement.offset).toBeGreaterThanOrEqual(0);
            expect(placement.offset + item.width).toBeLessThanOrEqual(
              inches(lengths.get(placement.wallId)!),
            );
          } else {
            expect(isLen(placement.x) && isLen(placement.y)).toBe(true);
            expect(placement.rotation % 90).toBe(0);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('snapResize', () => {
  const doc = kitchen([
    on('base.standard', 'wall-north', 30),
    on('appliance.fridge', 'wall-east', 0, { width: inches(30) }),
    on('filler.base', 'wall-south', 10),
    free('base.standard', 48, 48),
    free('base.standard', 48, 48, 90),
  ]);
  const [cabinet, fridge, filler, island, turned] = doc.items as [Item, Item, Item, Item, Item];
  const at = (x: number, y: number) => ({ x: x * 16, y: y * 16 });

  it('gives the nearest 3 in width when the right handle is dragged', () => {
    expect(snapResize(doc, catalog, cabinet, 'right', at(70.2, 5))).toEqual({
      width: inches(39),
      placement: onWall('wall-north', 30),
    });
    expect(snapResize(doc, catalog, cabinet, 'right', at(52, 5)).width).toBe(inches(21));
  });

  it('keeps the right edge fixed when the left handle is dragged', () => {
    expect(snapResize(doc, catalog, cabinet, 'left', at(25, 5))).toEqual({
      width: inches(36),
      placement: onWall('wall-north', 24),
    });
  });

  it('keeps to the widths the entry comes in', () => {
    expect(snapResize(doc, catalog, cabinet, 'right', at(140, 5)).width).toBe(inches(48));
    expect(snapResize(doc, catalog, cabinet, 'right', at(31, 5)).width).toBe(inches(9));
    expect(snapResize(doc, catalog, fridge, 'right', at(140, 32)).width).toBe(inches(33));
    // A filler comes at any width to the sixteenth: here 3 5/16 in.
    expect(snapResize(doc, catalog, filler, 'left', at(134.3125, 118))).toEqual({
      width: 53,
      placement: { type: 'wall', wallId: 'wall-south', offset: 155 },
    });
  });

  it('never grows an item past either end of its wall', () => {
    const tight = kitchen([
      on('base.standard', 'wall-north', 108),
      on('base.standard', 'wall-east', 3),
    ]);
    const [atEnd, atStart] = tight.items as [Item, Item];
    expect(snapResize(tight, catalog, atEnd, 'right', at(200, 5)).width).toBe(inches(36));
    expect(snapResize(tight, catalog, atStart, 'left', at(140, -20))).toEqual({
      width: inches(33),
      placement: onWall('wall-east', 0),
    });
  });

  it('keeps the width when no allowed width fits the wall', () => {
    const narrow = kitchen([on('base.standard', 'wall-north', 0)], { width: 6 });
    expect(snapResize(narrow, catalog, narrow.items[0]!, 'right', at(3, 5))).toEqual({
      width: inches(30),
      placement: onWall('wall-north', 0),
    });
  });

  it('resizes a free-standing item along its own back edge', () => {
    expect(snapResize(doc, catalog, island, 'right', at(90.5, 70))).toEqual({
      width: inches(42),
      placement: island.placement,
    });
    expect(snapResize(doc, catalog, island, 'left', at(41, 70))).toEqual({
      width: inches(36),
      placement: { type: 'free', x: inches(42), y: inches(48), rotation: 0 },
    });
    // Turned 90 degrees, its back edge runs down the plan.
    expect(snapResize(doc, catalog, turned, 'left', at(30, 42.5))).toEqual({
      width: inches(36),
      placement: { type: 'free', x: inches(48), y: inches(42), rotation: 90 },
    });
  });

  it('falls back to 3 in steps for an item the catalog does not know', () => {
    const unknown = { ...cabinet, catalogId: 'nope' };
    expect(snapResize(doc, catalog, unknown, 'right', at(47.4, 5)).width).toBe(inches(18));
    expect(snapResize(doc, catalog, unknown, 'right', at(20, 5)).width).toBe(inches(3));
  });

  it('leaves an item on a wall the document does not have as it is', () => {
    const lost = { ...cabinet, placement: onWall('wall-gone', 30) };
    expect(snapResize(doc, catalog, lost, 'right', at(70, 5))).toEqual({
      width: cabinet.width,
      placement: lost.placement,
    });
  });
});
