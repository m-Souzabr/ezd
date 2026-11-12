import { describe, expect, it } from 'vitest';

import { applyCommand, type Command } from '../commands/index.js';
import {
  type Countertop,
  createEmptyDocument,
  type DesignDocument,
  type Item,
  parseDocument,
} from '../document/index.js';
import { inches } from '../units/index.js';
import {
  COUNTER_HEIGHT,
  defaultItemFor,
  getEntry,
  proposeCountertops,
  SEED_CATALOG,
} from './index.js';

const context = { catalog: SEED_CATALOG };

function applyAll(doc: DesignDocument, commands: Command[]): DesignDocument {
  const applied = applyCommand(doc, { type: 'batch', commands }, context);
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.value.doc;
}

type Spec = [catalogId: string, wallId: string, offsetInches: number, overrides?: Partial<Item>];

/**
 * A 120 in north wall that meets a 96 in east wall at its end, with the given items on
 * them. Every item is checked against the seed catalog on the way in.
 */
function kitchen(specs: Spec[], closed = false): DesignDocument {
  const corners = [
    { x: 0, y: 0 },
    { x: inches(120), y: 0 },
    { x: inches(120), y: inches(96) },
    { x: 0, y: inches(96) },
  ];
  const names = ['wall-north', 'wall-east', 'wall-south', 'wall-west'];
  const walls = names.slice(0, closed ? 4 : 2).map((id, i) => ({
    id,
    start: corners[i]!,
    end: corners[(i + 1) % 4]!,
    thickness: inches(4.5),
  }));
  return applyAll(createEmptyDocument({ id: 'doc-00000001', name: 'Test kitchen' }), [
    ...walls.map((wall): Command => ({ type: 'wall.add', wall })),
    ...specs.map(([catalogId, wallId, offset, overrides], i): Command => ({
      type: 'item.add',
      item: {
        ...defaultItemFor(
          getEntry(SEED_CATALOG, catalogId)!,
          `item-${String(i).padStart(4, '0')}`,
          {
            type: 'wall',
            wallId,
            offset: inches(offset),
          },
        ),
        ...overrides,
      },
    })),
  ]);
}

/** The proposed countertops as [wall, start, end] in inches. */
function proposed(doc: DesignDocument): [string, number, number][] {
  return tops(doc).map((top) => [top.wallId, top.startOffset / 16, top.endOffset / 16]);
}
const tops = (doc: DesignDocument): Countertop[] =>
  proposeCountertops(doc, SEED_CATALOG).map((command) => {
    if (command.type !== 'countertop.add') throw new Error(`unexpected ${command.type}`);
    return command.countertop;
  });

const w = (inchesWide: number) => ({ width: inches(inchesWide) });

describe('proposeCountertops', () => {
  it('covers a single run of base cabinets, a sink base and a dishwasher with one top', () => {
    const doc = kitchen([
      ['base.standard', 'wall-north', 0],
      ['appliance.dishwasher', 'wall-north', 30],
      ['base.sink', 'wall-north', 54],
      // Above the counter, so not part of the run.
      ['wall.standard', 'wall-north', 0],
    ]);
    expect(tops(doc)).toEqual([
      {
        id: 'countertop-01',
        wallId: 'wall-north',
        startOffset: 0,
        endOffset: inches(90),
        depth: inches(25.5),
        thickness: inches(1.5),
        elevation: inches(34.5),
      },
    ]);
  });

  it('tops a 34.5 in base out at exactly 36 in', () => {
    const doc = kitchen([['base.standard', 'wall-north', 12]]);
    const [top] = tops(doc);
    const base = doc.items[0]!;
    expect(base.elevation + base.height).toBe(inches(34.5));
    expect(top!.elevation).toBe(base.elevation + base.height);
    expect(top!.elevation + top!.thickness).toBe(inches(36));
    expect(top!.elevation + top!.thickness).toBe(COUNTER_HEIGHT);
  });

  it('returns commands that apply, and proposes nothing once they have', () => {
    const doc = kitchen([
      ['base.standard', 'wall-north', 0],
      ['base.standard', 'wall-east', 30],
    ]);
    const commands = proposeCountertops(doc, SEED_CATALOG);
    expect(commands).toHaveLength(2);
    const topped = applyAll(doc, commands);
    expect(parseDocument(topped).ok).toBe(true);
    expect(topped.countertops).toHaveLength(2);
    expect(proposeCountertops(topped, SEED_CATALOG)).toEqual([]);
  });

  it('skips ids the document already uses', () => {
    const doc = applyAll(kitchen([['base.standard', 'wall-north', 0]]), [
      {
        type: 'countertop.add',
        countertop: {
          id: 'countertop-01',
          wallId: 'wall-east',
          startOffset: 0,
          endOffset: inches(12),
          depth: inches(25.5),
          thickness: inches(1.5),
          elevation: inches(34.5),
        },
      },
    ]);
    expect(tops(doc).map((top) => top.id)).toEqual(['countertop-02']);
  });

  it('splits a run at a range', () => {
    const doc = kitchen([
      ['base.standard', 'wall-north', 0],
      ['appliance.range', 'wall-north', 30],
      ['base.drawers', 'wall-north', 60],
    ]);
    expect(proposed(doc)).toEqual([
      ['wall-north', 0, 30],
      ['wall-north', 60, 84],
    ]);
  });

  it('splits a run at a tall cabinet, a refrigerator or any gap', () => {
    const doc = kitchen([
      ['base.standard', 'wall-north', 0, w(12)],
      ['tall.pantry', 'wall-north', 12],
      ['base.standard', 'wall-north', 36, w(12)],
      ['appliance.fridge', 'wall-north', 48],
      ['base.standard', 'wall-north', 84, w(12)],
      // A 1/16 in gap.
      [
        'base.standard',
        'wall-north',
        96,
        { ...w(12), placement: { type: 'wall', wallId: 'wall-north', offset: inches(96) + 1 } },
      ],
    ]);
    expect(proposed(doc)).toEqual([
      ['wall-north', 0, 12],
      ['wall-north', 36, 48],
      ['wall-north', 84, 96],
      ['wall-north', 96 + 1 / 16, 108 + 1 / 16],
    ]);
  });

  it('runs over fillers and end panels, whatever order the items are in', () => {
    const doc = kitchen([
      ['base.standard', 'wall-north', 33.75],
      ['filler.base', 'wall-north', 30.75],
      ['panel.end', 'wall-north', 30],
      ['appliance.dishwasher', 'wall-north', 6],
    ]);
    expect(proposed(doc)).toEqual([['wall-north', 6, 63.75]]);
    expect(tops(doc)[0]!.depth).toBe(inches(25.5));
  });

  it('ignores free-standing items and documents with nothing to cover', () => {
    const doc = kitchen([
      [
        'base.standard',
        'wall-north',
        0,
        { placement: { type: 'free', x: 500, y: 500, rotation: 0 } },
      ],
      ['appliance.range', 'wall-north', 0],
    ]);
    expect(proposed(doc)).toEqual([]);
    expect(
      proposeCountertops(createEmptyDocument({ id: 'doc-00000001', name: 'Empty' }), SEED_CATALOG),
    ).toEqual([]);
  });

  describe('where two walls meet', () => {
    it('covers an L-shaped kitchen with one top per wall, butt-joined at the corner', () => {
      // The blind corner sits on the east wall, in the corner. The north run stops at its
      // side, 24 in short of the corner.
      const doc = kitchen([
        ['base.standard', 'wall-north', 60, w(36)],
        ['base.corner.blind', 'wall-east', 0],
        ['base.standard', 'wall-east', 36],
      ]);
      // The east top owns the corner. The north top stops at its front edge, 25.5 in out.
      expect(proposed(doc)).toEqual([
        ['wall-north', 60, 94.5],
        ['wall-east', 0, 66],
      ]);
      expect(tops(doc).map((top) => top.depth)).toEqual([inches(25.5), inches(25.5)]);
    });

    it('lets the run that reaches the end of its wall own the corner instead', () => {
      const doc = kitchen([
        ['base.corner.blind', 'wall-north', 84, { options: { blind: 'right' } }],
        ['base.standard', 'wall-east', 24],
      ]);
      expect(proposed(doc)).toEqual([
        ['wall-north', 84, 120],
        ['wall-east', 25.5, 54],
      ]);
    });

    it('carries the far leg of a Lazy Susan on the top of the wall before', () => {
      const doc = kitchen([
        ['base.standard', 'wall-north', 54],
        ['base.corner.susan', 'wall-east', 0],
      ]);
      expect(proposed(doc)).toEqual([
        ['wall-north', 54, 94.5],
        ['wall-east', 0, 36],
      ]);
      // Each leg is 24 in deep, not the 36 in the cabinet spans along the other wall.
      expect(tops(doc).map((top) => top.depth)).toEqual([inches(25.5), inches(25.5)]);
    });

    it('treats a Lazy Susan away from a corner as a plain run', () => {
      const first = kitchen([['base.corner.susan', 'wall-north', 0]]);
      expect(proposed(first)).toEqual([['wall-north', 0, 36]]);
      const middle = kitchen([['base.corner.susan', 'wall-east', 12]]);
      expect(proposed(middle)).toEqual([['wall-east', 12, 48]]);
    });

    it('leaves runs away from the corner alone', () => {
      const doc = kitchen([
        ['base.standard', 'wall-north', 0],
        ['base.standard', 'wall-east', 0],
        ['base.standard', 'wall-east', 60],
      ]);
      expect(proposed(doc)).toEqual([
        ['wall-north', 0, 30],
        ['wall-east', 0, 30],
        ['wall-east', 60, 90],
      ]);
    });

    it('drops a top that the corner leaves no room for', () => {
      const doc = kitchen([
        ['filler.base', 'wall-north', 117],
        ['base.standard', 'wall-east', 0],
      ]);
      expect(proposed(doc)).toEqual([['wall-east', 0, 30]]);
    });

    it('joins at every corner of a closed room', () => {
      const doc = kitchen(
        [
          ['base.corner.blind', 'wall-north', 0],
          ['base.standard', 'wall-north', 36, w(48)],
          ['base.standard', 'wall-north', 84, w(36)],
          ['base.standard', 'wall-east', 24, w(48)],
          ['base.standard', 'wall-west', 36, w(36)],
        ],
        true,
      );
      expect(proposed(doc)).toEqual([
        ['wall-north', 0, 120],
        ['wall-east', 25.5, 72],
        ['wall-west', 36, 70.5],
      ]);
    });
  });
});
