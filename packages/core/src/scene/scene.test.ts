import { describe, expect, it } from 'vitest';

import { type Catalog, SEED_CATALOG, WALL_CABINET_DEPTH } from '../catalog/index.js';
import { createEmptyDocument, type DesignDocument } from '../document/index.js';
import { IN, inches } from '../units/index.js';
import { clone } from '../test/fixtures.js';
import { door, free, kitchen, on, WALL_IDS, windowAt } from '../test/kitchen.js';
import { buildScene, type SceneBox, type SceneFloor, type SceneNode } from './index.js';

const [NORTH, EAST, SOUTH, WEST] = WALL_IDS;

/** The 120 in by 96 in room of the issue, with a 96 in ceiling and 4 1/2 in walls. */
const room = (...args: Parameters<typeof kitchen>): DesignDocument =>
  kitchen(args[0], { width: 120, depth: 96, ...args[1] });

const scene = (doc: DesignDocument, catalog: Catalog = SEED_CATALOG) => buildScene(doc, catalog);
const boxes = (nodes: SceneNode[]): SceneBox[] => nodes.filter((node) => node.kind === 'box');
const floors = (nodes: SceneNode[]): SceneFloor[] => nodes.filter((node) => node.kind === 'floor');
const from = (nodes: SceneNode[], sourceId: string): SceneBox[] =>
  boxes(nodes).filter((box) => box.sourceId === sourceId);
const volume = (box: SceneBox): number => box.size[0] * box.size[1] * box.size[2];

/** The four plan corners of a box, as world (x, z). */
function corners(box: SceneBox): [number, number][] {
  const radians = (box.rotationY * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const out: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = (sx * box.size[0]) / 2;
      const lz = (sz * box.size[2]) / 2;
      out.push([box.position[0] + lx * cos + lz * sin, box.position[2] - lx * sin + lz * cos]);
    }
  }
  return out;
}

/** `[minX, maxX, minZ, maxZ]` over the corners of all the boxes. */
function extent(list: SceneBox[]): [number, number, number, number] {
  const points = list.flatMap(corners);
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}

describe('buildScene: room', () => {
  it('turns an empty 120 x 96 in room into four wall boxes and one floor polygon', () => {
    const nodes = scene(room());
    expect(nodes).toHaveLength(5);
    expect(floors(nodes)).toEqual([
      {
        kind: 'floor',
        id: 'floor',
        finish: 'floor.oak',
        polygon: [
          [0, 0],
          [120, 0],
          [120, 96],
          [0, 96],
        ],
      },
    ]);
    expect(boxes(nodes)).toEqual([
      {
        kind: 'box',
        id: 'wall-north:0',
        sourceId: NORTH,
        role: 'wall',
        finish: 'wall.white',
        size: [120, 96, 4.5],
        position: [60, 48, -2.25],
        rotationY: 0,
      },
      {
        kind: 'box',
        id: 'wall-east:0',
        sourceId: EAST,
        role: 'wall',
        finish: 'wall.white',
        size: [96, 96, 4.5],
        position: [122.25, 48, 48],
        rotationY: 270,
      },
      {
        kind: 'box',
        id: 'wall-south:0',
        sourceId: SOUTH,
        role: 'wall',
        finish: 'wall.white',
        size: [120, 96, 4.5],
        position: [60, 48, 98.25],
        rotationY: 180,
      },
      {
        kind: 'box',
        id: 'wall-west:0',
        sourceId: WEST,
        role: 'wall',
        finish: 'wall.white',
        size: [96, 96, 4.5],
        position: [-2.25, 48, 48],
        rotationY: 90,
      },
    ]);
  });

  it('puts every wall outside the room, against its interior face', () => {
    const nodes = scene(room());
    expect(extent(from(nodes, NORTH))).toEqual([0, 120, -4.5, 0]);
    const [x0, x1, z0, z1] = extent(from(nodes, EAST));
    expect(x0).toBeCloseTo(120);
    expect(x1).toBeCloseTo(124.5);
    expect(z0).toBeCloseTo(0);
    expect(z1).toBeCloseTo(96);
  });

  it('splits a wall with a door into the left, right and above pieces', () => {
    const nodes = scene(room([], { openings: [door(NORTH, 24, 32)] }));
    const wall = from(nodes, NORTH);
    expect(wall.map((box) => box.id)).toEqual(['wall-north:0', 'wall-north:1', 'wall-north:2']);
    expect(wall.map((box) => [box.size, box.position])).toEqual([
      [
        [24, 96, 4.5],
        [12, 48, -2.25],
      ],
      [
        [32, 16, 4.5],
        [40, 88, -2.25],
      ],
      [
        [64, 96, 4.5],
        [88, 48, -2.25],
      ],
    ]);
    const total = wall.reduce((sum, box) => sum + volume(box), 0);
    expect(total).toBe(120 * 96 * 4.5 - 32 * 80 * 4.5);
  });

  it('splits a wall with a window into four pieces', () => {
    const nodes = scene(room([], { openings: [windowAt(EAST, 30, 36)] }));
    const wall = from(nodes, EAST);
    expect(wall).toHaveLength(4);
    // Left, below the sill, above the head, right.
    expect(wall.map((box) => box.size)).toEqual([
      [30, 96, 4.5],
      [36, 36, 4.5],
      [36, 24, 4.5],
      [30, 96, 4.5],
    ]);
    expect(wall.map((box) => box.position[1])).toEqual([48, 18, 84, 48]);
    expect(wall.reduce((sum, box) => sum + volume(box), 0)).toBe(96 * 96 * 4.5 - 36 * 36 * 4.5);
  });

  it('leaves out the pieces an opening leaves no room for', () => {
    // A full-height door at the very start of the wall: only the stretch after it remains.
    const nodes = scene(
      room([], {
        openings: [door(NORTH, 0, 30)],
        patch: (doc) => {
          doc.room.openings[0]!.height = inches(96);
        },
      }),
    );
    expect(from(nodes, NORTH).map((box) => box.size)).toEqual([[90, 96, 4.5]]);
  });

  it('cuts overlapping and overhanging openings to what is left of the wall', () => {
    const nodes = scene(
      room([], {
        openings: [
          door(NORTH, 100, 40),
          door(NORTH, 20, 30),
          door(NORTH, 40, 20),
          door(NORTH, 25, 10),
        ],
      }),
    );
    const wall = from(nodes, NORTH);
    // Solid 0-20, above 20-50, above 50-60, solid 60-100, above 100-120.
    expect(wall.map((box) => [box.size[0], box.size[1]])).toEqual([
      [20, 96],
      [30, 16],
      [10, 16],
      [40, 96],
      [20, 16],
    ]);
  });

  it("uses a wall's own height over the ceiling height", () => {
    const nodes = scene(
      room([], {
        patch: (doc) => {
          doc.room.walls[0]!.height = inches(42);
        },
      }),
    );
    expect(from(nodes, NORTH)[0]!.size).toEqual([120, 42, 4.5]);
    expect(from(nodes, EAST)[0]!.size).toEqual([96, 96, 4.5]);
  });

  it('floors an open room with the rectangle around its walls plus 24 in', () => {
    const nodes = scene(room([], { walls: 2 }));
    expect(floors(nodes)[0]!.polygon).toEqual([
      [-24, -24],
      [144, -24],
      [144, 120],
      [-24, 120],
    ]);
  });

  it('returns nothing for an empty document', () => {
    expect(scene(createEmptyDocument({ id: 'doc-00000001', name: 'Empty' }))).toEqual([]);
  });

  it('follows a wall that is not axis-aligned', () => {
    const doc = room([], {
      walls: 1,
      patch: (d) => {
        d.room.walls[0]!.end = { x: inches(30), y: inches(40) };
      },
    });
    const [wall] = from(scene(doc), NORTH);
    expect(wall!.size).toEqual([50, 96, 4.5]);
    // The wall runs along (0.6, 0.8); the room is on its (-0.8, 0.6) side.
    expect(wall!.position[0]).toBeCloseTo(15 + 0.8 * 2.25);
    expect(wall!.position[2]).toBeCloseTo(20 - 0.6 * 2.25);
    expect(wall!.rotationY).toBeCloseTo(360 - 53.130102);
  });
});

describe('buildScene: items', () => {
  it('keeps a base cabinet on each wall inside the room with its back on the wall', () => {
    const doc = room(WALL_IDS.map((wallId) => on('base.standard', wallId, 36)));
    const nodes = scene(doc);
    // Distance from each wall's interior face into the room.
    const into = [
      (_x: number, z: number) => z,
      (x: number) => 120 - x,
      (_x: number, z: number) => 96 - z,
      (x: number) => x,
    ];
    doc.items.forEach((item, i) => {
      const parts = from(nodes, item.id);
      expect(parts.length).toBeGreaterThan(5);
      const [x0, x1, z0, z1] = extent(parts);
      expect(x0).toBeGreaterThanOrEqual(-1e-6);
      expect(x1).toBeLessThanOrEqual(120 + 1e-6);
      expect(z0).toBeGreaterThanOrEqual(-1e-6);
      expect(z1).toBeLessThanOrEqual(96 + 1e-6);
      for (const part of parts) {
        expect(part.position[1] - part.size[1] / 2).toBeGreaterThanOrEqual(0);
        expect(part.position[1] + part.size[1] / 2).toBeLessThanOrEqual(34.5);
      }

      const distances = parts.flatMap(corners).map(([x, z]) => into[i]!(x, z));
      expect(Math.min(...distances)).toBeCloseTo(0);
      // 24 in deep, and the door stands 3/4 in proud of the front.
      expect(Math.max(...distances)).toBeCloseTo(24.75);
      const back = parts.find((part) => part.role === 'back')!;
      expect(Math.min(...corners(back).map(([x, z]) => into[i]!(x, z)))).toBeCloseTo(0);
    });
  });

  it('places a part by the item offset and elevation', () => {
    const doc = room([on('wall.standard', NORTH, 36)]);
    const item = doc.items[0]!;
    const parts = from(scene(doc), item.id);
    const [x0, x1, z0, z1] = extent(parts.filter((part) => part.role !== 'door'));
    expect([x0, x1, z0, z1]).toEqual([36, 36 + item.width / IN, 0, item.depth / IN]);
    const bottoms = parts.map((part) => part.position[1] - part.size[1] / 2);
    expect(Math.min(...bottoms)).toBe(item.elevation / IN);
    expect(parts.map((part) => part.id)).toEqual(parts.map((_, i) => `${item.id}:${i}`));
    expect(new Set(parts.map((part) => part.sourceId))).toEqual(new Set([item.id]));
  });

  it('turns a free-standing island with its rotation', () => {
    const doc = room([free('base.standard', 80, 30, 90)]);
    const item = doc.items[0]!;
    const parts = from(scene(doc), item.id);
    expect(new Set(parts.map((part) => part.rotationY))).toEqual(new Set([270]));
    // The back runs down from (80, 30) and the cabinet extends toward -x.
    const fronts = ['door', 'drawer-front'];
    const carcass = parts.filter((part) => !fronts.includes(part.role));
    const [x0, x1, z0, z1] = extent(carcass);
    expect(x0).toBeCloseTo(80 - item.depth / IN);
    expect(x1).toBeCloseTo(80);
    expect(z0).toBeCloseTo(30);
    expect(z1).toBeCloseTo(30 + item.width / IN);
    expect(extent(parts)[0]).toBeCloseTo(80 - item.depth / IN - 0.75);
  });

  it('leaves an unrotated free item axis-aligned', () => {
    const doc = room([free('appliance.range', 40, 30)]);
    const item = doc.items[0]!;
    expect(from(scene(doc), item.id)).toEqual([
      {
        kind: 'box',
        id: `${item.id}:0`,
        sourceId: item.id,
        role: 'body',
        finish: null,
        size: [item.width / IN, item.height / IN, item.depth / IN],
        position: [40 + item.width / IN / 2, item.height / IN / 2, 30 + item.depth / IN / 2],
        rotationY: 0,
      },
    ]);
  });

  it('turns the rotated parts of a diagonal corner cabinet', () => {
    const doc = room([on('wall.corner.diagonal', NORTH, 0)]);
    const item = doc.items[0]!;
    const W = item.width / IN;
    const L = WALL_CABINET_DEPTH / IN;
    const parts = from(scene(doc), item.id);
    const doorBox = parts.find((part) => part.role === 'door')!;
    expect(doorBox.rotationY).toBe(225);
    // The door runs from (W, L) toward (L, W), its thickness toward the corner.
    const points = corners(doorBox);
    const near = (x: number, z: number, tolerance: number) =>
      points.some(([px, pz]) => Math.hypot(px - x, pz - z) <= tolerance);
    expect(near(W, L, 1e-6)).toBe(true);
    expect(near(L, W, 0.1)).toBe(true);
    const [x0, x1, z0, z1] = extent(parts);
    expect(x0).toBeGreaterThanOrEqual(-1e-6);
    expect(z0).toBeGreaterThanOrEqual(-1e-6);
    expect(x1).toBeLessThanOrEqual(W + 1e-6);
    expect(z1).toBeLessThanOrEqual(W + 1e-6);
  });

  it('skips an item with no catalog entry or no wall', () => {
    const doc = clone(room([on('base.standard', NORTH, 0), on('base.standard', NORTH, 36)]));
    doc.items[0]!.catalogId = 'base.unknown';
    doc.items[1]!.placement = { type: 'wall', wallId: 'wall-missing', offset: 0 };
    expect(boxes(scene(doc)).filter((box) => box.role !== 'wall')).toEqual([]);
  });
});

describe('buildScene: countertops', () => {
  const top = {
    wallId: EAST,
    startOffset: inches(12),
    endOffset: inches(72),
    depth: inches(25.5),
    thickness: inches(1.5),
    elevation: inches(34.5),
  };

  it('draws one box per countertop', () => {
    const nodes = scene(room([], { countertops: [top] }));
    expect(from(nodes, 'top-0000')).toEqual([
      {
        kind: 'box',
        id: 'top-0000:0',
        sourceId: 'top-0000',
        role: 'countertop',
        finish: 'countertop.white',
        size: [60, 1.5, 25.5],
        position: [120 - 12.75, 35.25, 42],
        rotationY: 270,
      },
    ]);
  });

  it('skips a countertop whose wall is missing', () => {
    const doc = clone(room([], { countertops: [top] }));
    doc.countertops[0]!.wallId = 'wall-missing';
    expect(boxes(scene(doc)).every((box) => box.role === 'wall')).toBe(true);
  });
});

describe('buildScene: finishes', () => {
  const top = {
    wallId: NORTH,
    startOffset: 0,
    endOffset: inches(30),
    depth: inches(25.5),
    thickness: inches(1.5),
    elevation: inches(34.5),
  };
  const specs = [on('base.standard', NORTH, 0), on('appliance.range', NORTH, 30)];
  const finishOf = (nodes: SceneNode[], role: string) =>
    boxes(nodes).find((box) => box.role === role)!.finish;

  it("falls back to the catalog's first finish for each target", () => {
    const nodes = scene(room(specs, { countertops: [top] }));
    expect(finishOf(nodes, 'wall')).toBe('wall.white');
    expect(finishOf(nodes, 'side')).toBe('cabinet.white');
    expect(finishOf(nodes, 'door')).toBe('cabinet.white');
    expect(finishOf(nodes, 'countertop')).toBe('countertop.white');
    expect(floors(nodes)[0]!.finish).toBe('floor.oak');
  });

  it('prefers the document finish to the catalog default', () => {
    const nodes = scene(
      room(specs, {
        countertops: [top],
        patch: (doc) => {
          doc.finishes = {
            cabinet: 'cabinet.navy',
            countertop: 'countertop.charcoal',
            wall: 'wall.greige',
            floor: 'floor.slate',
          };
        },
      }),
    );
    expect(finishOf(nodes, 'wall')).toBe('wall.greige');
    expect(finishOf(nodes, 'side')).toBe('cabinet.navy');
    expect(finishOf(nodes, 'countertop')).toBe('countertop.charcoal');
    expect(floors(nodes)[0]!.finish).toBe('floor.slate');
  });

  it("prefers an item's or countertop's own finish to the document finish", () => {
    const nodes = scene(
      room([on('base.standard', NORTH, 0, { finishId: 'cabinet.sage' }), specs[1]!], {
        countertops: [{ ...top, finishId: 'countertop.butcher' }],
        patch: (doc) => {
          doc.finishes = { cabinet: 'cabinet.navy', countertop: 'countertop.charcoal' };
        },
      }),
    );
    expect(finishOf(nodes, 'side')).toBe('cabinet.sage');
    expect(finishOf(nodes, 'door')).toBe('cabinet.sage');
    expect(finishOf(nodes, 'countertop')).toBe('countertop.butcher');
  });

  it('gives appliances no finish, whatever the item says', () => {
    const nodes = scene(
      room([on('appliance.range', NORTH, 30, { finishId: 'cabinet.sage' })], {
        patch: (doc) => {
          doc.finishes = { cabinet: 'cabinet.navy' };
        },
      }),
    );
    expect(finishOf(nodes, 'body')).toBeNull();
  });

  it('resolves to null when the catalog has no finish for the target', () => {
    const nodes = scene(room(specs, { countertops: [top] }), { ...SEED_CATALOG, finishes: [] });
    expect(new Set(boxes(nodes).map((box) => box.finish))).toEqual(new Set([null]));
    expect(floors(nodes)[0]!.finish).toBeNull();
  });
});

describe('buildScene: determinism', () => {
  const doc = room(
    [
      on('base.standard', NORTH, 0),
      on('wall.corner.diagonal', EAST, 0),
      on('tall.pantry', SOUTH, 60),
      free('base.drawers', 50, 40, 45),
    ],
    {
      openings: [door(SOUTH, 6, 32, 'in-left'), windowAt(NORTH, 42, 36)],
      countertops: [
        {
          wallId: NORTH,
          startOffset: 0,
          endOffset: inches(30),
          depth: inches(25.5),
          thickness: inches(1.5),
          elevation: inches(34.5),
        },
      ],
    },
  );

  it('returns deep-equal output for two calls and does not touch its input', () => {
    // The document is frozen, so any write would throw.
    const first = scene(doc);
    expect(scene(doc)).toEqual(first);
    expect(scene(clone(doc))).toEqual(first);
  });

  it('orders the floor, then walls, items and countertops, with unique ids', () => {
    const nodes = scene(doc);
    expect(nodes[0]!.kind).toBe('floor');
    const sources = boxes(nodes).map((box) => box.sourceId);
    expect(sources.filter((id, i) => id !== sources[i - 1])).toEqual([
      ...WALL_IDS,
      ...doc.items.map((item) => item.id),
      'top-0000',
    ]);
    const ids = nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only produces finite numbers and no negative zero', () => {
    for (const box of boxes(scene(doc))) {
      for (const n of [...box.size, ...box.position, box.rotationY]) {
        expect(Number.isFinite(n)).toBe(true);
        expect(Object.is(n, -0)).toBe(false);
      }
      expect(box.rotationY).toBeGreaterThanOrEqual(0);
      expect(box.rotationY).toBeLessThan(360);
    }
  });
});
