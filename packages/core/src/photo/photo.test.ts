import { describe, expect, it } from 'vitest';

import { SEED_CATALOG } from '../catalog/index.js';
import { applyCommand } from '../commands/index.js';
import { createEmptyDocument, DEFAULT_CEILING_HEIGHT, parseDocument } from '../document/index.js';
import { wallNormal } from '../geometry/index.js';
import { draftRoomJsonSchema, roomDraftJsonSchema } from '../schema/index.js';
import { inches } from '../units/index.js';
import {
  type DraftNewId,
  draftPreview,
  draftProblems,
  draftToCommands,
  normalizeDraft,
  PREVIEW_LENGTH,
  setDraftShape,
  SHAPE_WALL_COUNT,
} from './draft.js';
import {
  type DraftRoom,
  DraftRoomSchema,
  type DraftShape,
  type RoomDraft,
  RoomDraftSchema,
} from './schema.js';

const catalog = SEED_CATALOG;

/** An L kitchen as a model might describe it, with the walls under their own labels. */
const modelAnswer = (overrides: Partial<DraftRoom> = {}): DraftRoom => ({
  shape: 'l-shape',
  ceilingHeightIn: 96,
  walls: [
    { label: 'back', lengthIn: 144, visible: true, confidence: 'high' },
    { label: 'right', lengthIn: 120.03, visible: true, confidence: 'low' },
  ],
  openings: [
    {
      wall: 'back',
      kind: 'window',
      offsetIn: 40,
      widthIn: 36,
      heightIn: null,
      sillIn: null,
      confidence: 'medium',
    },
    {
      wall: 'right',
      kind: 'door',
      offsetIn: 80,
      widthIn: 32,
      heightIn: 80,
      sillIn: 12,
      confidence: 'high',
    },
  ],
  items: [
    { wall: 'back', category: 'base', offsetIn: 0, widthIn: 31, confidence: 'high' },
    { wall: 'back', category: 'sink', offsetIn: 30, widthIn: 36, confidence: 'medium' },
    { wall: 'right', category: 'fridge', offsetIn: null, widthIn: null, confidence: 'low' },
  ],
  notes: 'A window over the sink.',
  ...overrides,
});

/** Every length typed by the user. */
function confirmed(draft: RoomDraft): RoomDraft {
  const typed = <T extends { value: number | null; estimated: boolean }>(len: T): T => ({
    ...len,
    estimated: false,
  });
  return {
    ...draft,
    walls: draft.walls.map((wall) => ({ ...wall, length: typed(wall.length) })),
    galleyWidth: typed(draft.galleyWidth),
  };
}

function ids(): DraftNewId {
  let n = 0;
  return (prefix) => `${prefix}-id-${String((n += 1)).padStart(3, '0')}`;
}

/** The draft for a shape, every wall at `length`, ready to confirm. */
function shapeDraft(shape: DraftShape, length = inches(120)): RoomDraft {
  const base = normalizeDraft(modelAnswer({ openings: [], items: [] }), catalog);
  const draft = setDraftShape({ ...base, walls: [] }, shape);
  return confirmed({
    ...draft,
    walls: draft.walls.map((wall) => ({ ...wall, length: { value: length, estimated: false } })),
    galleyWidth: { value: inches(96), estimated: false },
  });
}

function build(draft: RoomDraft) {
  const command = draftToCommands(draft, ids());
  if (!command.ok) throw new Error(command.error.join('\n'));
  const applied = applyCommand(
    createEmptyDocument({ id: 'photo-design', name: 'Kitchen' }),
    command.value,
    {
      catalog,
    },
  );
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.value.doc;
}

describe('the draft schemas', () => {
  it('accept a model answer and its normalized draft', () => {
    expect(DraftRoomSchema.safeParse(modelAnswer()).success).toBe(true);
    expect(RoomDraftSchema.safeParse(normalizeDraft(modelAnswer(), catalog)).success).toBe(true);
  });

  it('export strict JSON Schema for structured output', () => {
    const schema = draftRoomJsonSchema();
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      'shape',
      'ceilingHeightIn',
      'walls',
      'openings',
      'items',
      'notes',
    ]);
    expect(roomDraftJsonSchema().title).toBe('EZDesign room draft');
  });

  it('refuse a model answer with an extra field or a negative length', () => {
    expect(DraftRoomSchema.safeParse({ ...modelAnswer(), extra: 1 }).success).toBe(false);
    const walls = [{ label: 'A', lengthIn: -1, visible: true, confidence: 'high' }];
    expect(DraftRoomSchema.safeParse({ ...modelAnswer(), walls }).success).toBe(false);
  });
});

describe('normalizeDraft', () => {
  const draft = normalizeDraft(modelAnswer(), catalog);

  it('relabels walls A, B and keeps references to them', () => {
    expect(draft.walls.map((wall) => wall.label)).toEqual(['A', 'B']);
    expect(draft.openings.map((opening) => opening.wall)).toEqual(['A', 'B']);
    expect(draft.items.map((item) => item.wall)).toEqual(['A', 'A', 'B']);
  });

  it('snaps a 31 in cabinet to 30 in and marks it unconfirmed', () => {
    const [base] = draft.items;
    expect(base).toMatchObject({ catalogId: 'base.standard', kind: 'base' });
    expect(base!.width).toEqual({ value: inches(30), estimated: true });
  });

  it('gives cabinets their standard height and depth', () => {
    const sink = draft.items[1]!;
    expect(sink).toMatchObject({ catalogId: 'base.sink', height: inches(34.5), depth: inches(24) });
  });

  it('gives an item with no width the catalog default, as an estimate', () => {
    expect(draft.items[2]!.width).toEqual({ value: inches(36), estimated: true });
    expect(draft.items[2]!.offset).toEqual({ value: null, estimated: false });
  });

  it('rounds lengths to 1/16 in and marks every model length as an estimate', () => {
    expect(draft.walls[1]!.length).toEqual({ value: Math.round(120.03 * 16), estimated: true });
    expect(draft.ceilingHeight).toEqual({ value: inches(96), estimated: true });
  });

  it('fills an opening height and sill with standard values, and gives a door no sill', () => {
    expect(draft.openings[0]).toMatchObject({
      height: { value: inches(36), estimated: true },
      sillHeight: { value: inches(42), estimated: true },
    });
    expect(draft.openings[1]!.sillHeight).toEqual({ value: 0, estimated: false });
  });

  it('keeps a window sill the model gave', () => {
    const answer = modelAnswer();
    answer.openings[0]!.sillIn = 40;
    expect(normalizeDraft(answer, catalog).openings[0]!.sillHeight.value).toBe(inches(40));
  });

  it('clamps offsets into their walls', () => {
    const answer = modelAnswer();
    answer.items[0]!.offsetIn = 140;
    answer.openings[0]!.offsetIn = 500;
    const clamped = normalizeDraft(answer, catalog);
    expect(clamped.items[0]!.offset.value).toBe(inches(144 - 30));
    expect(clamped.openings[0]!.offset.value).toBe(inches(144 - 36));
  });

  it('treats a missing, zero or absurd length as unknown', () => {
    const answer = modelAnswer({ ceilingHeightIn: null });
    answer.walls[0]!.lengthIn = 0;
    answer.walls[1]!.lengthIn = 5000;
    const unknown = normalizeDraft(answer, catalog);
    expect(unknown.walls.map((wall) => wall.length.value)).toEqual([null, null]);
    expect(unknown.ceilingHeight).toEqual({ value: DEFAULT_CEILING_HEIGHT, estimated: true });
  });

  it('drops what sits on a wall the model did not list, or has no catalog entry', () => {
    const answer = modelAnswer();
    answer.openings[0]!.wall = 'ceiling';
    answer.items[0]!.wall = 'island';
    const dropped = normalizeDraft(answer, {
      ...catalog,
      entries: catalog.entries.filter((e) => e.id !== 'base.sink'),
    });
    expect(dropped.openings).toHaveLength(1);
    expect(dropped.items.map((item) => item.category)).toEqual(['fridge']);
  });

  it('maps a label used twice to the first wall', () => {
    const answer = modelAnswer();
    answer.walls[1]!.label = 'back';
    const twice = normalizeDraft(answer, catalog);
    expect(twice.walls).toHaveLength(2);
    expect(twice.openings.map((opening) => opening.wall)).toEqual(['A']);
  });
});

describe('setDraftShape', () => {
  const draft = normalizeDraft(modelAnswer(), catalog);

  it('adds walls with no length up to the count of the shape', () => {
    const u = setDraftShape(draft, 'u-shape');
    expect(u.walls.map((wall) => wall.label)).toEqual(['A', 'B', 'C']);
    expect(u.walls[2]).toMatchObject({ length: { value: null, estimated: false }, visible: false });
  });

  it('removes walls at the end and keeps what was on them', () => {
    const one = setDraftShape(draft, 'single-wall');
    expect(one.walls).toHaveLength(1);
    expect(one.items).toHaveLength(3);
    expect(draftProblems(confirmed(one))).toContain(
      'Door 1 on wall B is on wall B, which the room does not have.',
    );
  });

  it('keeps the walls when the shape is unknown', () => {
    expect(setDraftShape(draft, 'unknown').walls).toHaveLength(2);
  });
});

describe('draftProblems', () => {
  it('lists a wall with no length and one that is only estimated', () => {
    const answer = modelAnswer({ items: [], openings: [] });
    answer.walls[0]!.lengthIn = null;
    expect(draftProblems(normalizeDraft(answer, catalog))).toEqual([
      'Type the length of wall A.',
      'Confirm the length of wall B, or type it.',
    ]);
  });

  it('asks for a shape, and for walls to match the shape', () => {
    const draft = confirmed(
      normalizeDraft(modelAnswer({ shape: 'unknown', items: [], openings: [] }), catalog),
    );
    expect(draftProblems(draft)).toEqual(['Pick the shape of the room.']);
    expect(draftProblems({ ...draft, shape: 'u-shape' })).toEqual([
      'This shape has 3 walls, but the draft has 2.',
    ]);
  });

  it('lists missing values, openings past a wall and overlapping items', () => {
    const draft = confirmed(normalizeDraft(modelAnswer(), catalog));
    draft.openings[1]!.offset = { value: inches(100), estimated: true };
    draft.items[1]!.offset = { value: inches(20), estimated: true };
    expect(draftProblems(draft)).toEqual([
      'Door 1 on wall B runs past the end of wall B.',
      'Sink base 36" at 20" on wall A overlaps base cabinet 30" at 0" on wall A.',
      'Give the offset of refrigerator 36" on wall B.',
    ]);
  });

  it('does not count a wall cabinet over a base cabinet as an overlap', () => {
    const answer = modelAnswer({ openings: [] });
    answer.items = [
      { wall: 'back', category: 'base', offsetIn: 0, widthIn: 30, confidence: 'high' },
      { wall: 'back', category: 'wall', offsetIn: 0, widthIn: 30, confidence: 'high' },
      { wall: 'right', category: 'base', offsetIn: 0, widthIn: 30, confidence: 'high' },
    ];
    expect(draftProblems(confirmed(normalizeDraft(answer, catalog)))).toEqual([]);
  });

  it('asks for a window sill, and refuses an opening with no size', () => {
    const draft = confirmed(normalizeDraft(modelAnswer({ items: [] }), catalog));
    draft.openings[0]!.sillHeight = { value: null, estimated: false };
    draft.openings[1]!.width = { value: 0, estimated: false };
    expect(draftProblems(draft)).toEqual([
      'Give the sill height of window 1 on wall A.',
      'Door 1 on wall B needs a width and a height.',
    ]);
  });

  it('asks for the width of a galley, typed or confirmed', () => {
    const galley = shapeDraft('galley');
    expect(draftProblems(galley)).toEqual([]);
    expect(draftProblems({ ...galley, galleyWidth: { value: null, estimated: false } })).toEqual([
      'Type the distance between walls A and B.',
    ]);
    expect(
      draftProblems({ ...galley, galleyWidth: { value: inches(96), estimated: true } }),
    ).toEqual(['Confirm the distance between walls A and B, or type it.']);
  });

  it('requires facing walls of a closed room to match', () => {
    const room = shapeDraft('rectangle');
    room.walls[2]!.length = { value: inches(100), estimated: false };
    expect(draftProblems(room)).toEqual([
      'Walls A and C face each other, so they must be the same length.',
    ]);
  });
});

describe('draftToCommands', () => {
  it('refuses a draft with nulls, with the problems', () => {
    const result = draftToCommands(normalizeDraft(modelAnswer(), catalog), ids());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Confirm the length of wall A, or type it.');
  });

  it('builds the walls, openings and items in one batch', () => {
    const draft = confirmed(normalizeDraft(modelAnswer(), catalog));
    draft.items[2]!.offset = { value: 0, estimated: false };
    const result = draftToCommands(draft, ids());
    expect(result.ok && result.value.type).toBe('batch');
    const doc = build(draft);
    expect(doc.room.walls).toHaveLength(2);
    expect(doc.room.openings.map((o) => [o.kind, o.offset, o.width, o.sillHeight])).toEqual([
      ['window', inches(40), inches(36), inches(42)],
      ['door', inches(80), inches(32), 0],
    ]);
    expect(doc.items.map((item) => [item.catalogId, item.width, item.placement])).toEqual([
      ['base.standard', inches(30), { type: 'wall', wallId: doc.room.walls[0]!.id, offset: 0 }],
      [
        'base.sink',
        inches(36),
        { type: 'wall', wallId: doc.room.walls[0]!.id, offset: inches(30) },
      ],
      ['appliance.fridge', inches(36), { type: 'wall', wallId: doc.room.walls[1]!.id, offset: 0 }],
    ]);
    expect(doc.room.ceilingHeight).toBe(inches(96));
  });

  it.each(['single-wall', 'galley', 'l-shape', 'u-shape', 'rectangle'] as const)(
    'gives a valid document with clockwise walls facing in for a %s',
    (shape) => {
      const doc = build(shapeDraft(shape));
      expect(parseDocument(doc).ok).toBe(true);
      expect(doc.room.walls).toHaveLength(SHAPE_WALL_COUNT[shape]!);
      // The interior normal of every wall points at the middle of the room.
      const points = doc.room.walls.flatMap((wall) => [wall.start, wall.end]);
      const middle = {
        x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
        y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
      };
      for (const wall of doc.room.walls) {
        const normal = wallNormal(wall);
        const toMiddle = { x: middle.x - wall.start.x, y: middle.y - wall.start.y };
        if (shape !== 'single-wall') {
          expect(normal.x * toMiddle.x + normal.y * toMiddle.y).toBeGreaterThan(0);
        } else {
          expect(normal).toEqual({ x: 0, y: 1 });
        }
      }
    },
  );

  it('closes a rectangle', () => {
    const doc = build(shapeDraft('rectangle'));
    expect(doc.room.walls.at(-1)!.end).toEqual(doc.room.walls[0]!.start);
  });
});

describe('draftPreview', () => {
  it('draws walls with no length at the preview length and leaves out what cannot be placed', () => {
    const answer = modelAnswer({ shape: 'unknown' });
    answer.walls[1]!.lengthIn = null;
    const { doc, skipped } = draftPreview(normalizeDraft(answer, catalog));
    expect(doc.room.walls).toHaveLength(2);
    expect(doc.room.walls[1]!.end.y).toBe(PREVIEW_LENGTH);
    // The refrigerator has no offset yet.
    expect(doc.items).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('counts commands that do not apply, and draws a galley at the preview width', () => {
    const draft = shapeDraft('galley');
    draft.galleyWidth = { value: null, estimated: false };
    draft.openings = [
      {
        wall: 'A',
        kind: 'door',
        offset: { value: 0, estimated: false },
        width: { value: inches(30), estimated: false },
        height: { value: null, estimated: false },
        sillHeight: { value: 0, estimated: false },
        confidence: 'high',
      },
    ];
    const { doc, skipped } = draftPreview(draft);
    expect(doc.room.walls[1]!.start.y).toBe(PREVIEW_LENGTH);
    expect(skipped).toBe(1);
  });

  it('draws nothing for an unknown shape with no walls', () => {
    const draft = {
      ...normalizeDraft(modelAnswer({ shape: 'unknown', items: [], openings: [] }), catalog),
      walls: [],
    };
    expect(draftPreview(draft).doc.room.walls).toEqual([]);
  });
});
