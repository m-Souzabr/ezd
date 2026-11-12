import { describe, expect, it } from 'vitest';

import { SEED_CATALOG } from '../catalog/index.js';
import { applyCommand, type Command } from '../commands/index.js';
import type { DesignDocument } from '../document/index.js';
import { door, free, kitchen, on, passage, windowAt } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { RULES, validate, type Violation } from './index.js';

// One describe per rule: at least one document that fails it and one that passes.

/** The violations of one rule. */
const of = (ruleId: string, doc: DesignDocument): Violation[] =>
  validate(doc, SEED_CATALOG).filter((violation) => violation.ruleId === ruleId);

/** The document after a violation's fix. */
function fixed(doc: DesignDocument, violation: Violation): DesignDocument {
  const applied = applyCommand(
    doc,
    { type: 'batch', commands: violation.fix! },
    { catalog: SEED_CATALOG },
  );
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.value.doc;
}

const w = (width: number) => ({ width: inches(width) });

describe('the rule list', () => {
  it('has each rule once, with a severity', () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
    for (const rule of RULES) expect(['error', 'warning', 'info']).toContain(rule.severity);
  });

  it('finds no errors or warnings in a sound kitchen', () => {
    const doc = kitchen([
      on('appliance.fridge', 'wall-north', 9),
      on('wall.fridge', 'wall-north', 9),
      on('base.standard', 'wall-north', 45, w(21)),
      on('base.sink', 'wall-north', 66),
      on('appliance.dishwasher', 'wall-north', 102),
      on('base.standard', 'wall-north', 126, w(18)),
      on('base.standard', 'wall-east', 24, w(24)),
      on('appliance.range', 'wall-east', 48),
      on('appliance.hood', 'wall-east', 48),
      on('base.standard', 'wall-east', 78, w(42)),
    ]);
    const found = validate(doc, SEED_CATALOG);
    expect(found.filter((violation) => violation.severity !== 'info')).toEqual([]);
    expect(found.map((violation) => violation.ruleId)).toEqual([
      'countertop.coverage',
      'countertop.coverage',
      'countertop.coverage',
    ]);
  });
});

describe('size.width-step', () => {
  it('passes a width on the 3 in step and a filler at any width in its range', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('filler.base', 'wall-north', 30, w(2.5)),
    ]);
    expect(of('size.width-step', doc)).toEqual([]);
  });

  it('fails a width off the step and suggests the nearest allowed one', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0, w(31))]);
    expect(of('size.width-step', doc)).toEqual([
      {
        ruleId: 'size.width-step',
        severity: 'error',
        itemIds: ['item-0000'],
        message:
          'Base cabinet 31" at 0" on wall A: Width 31" is not allowed for base.standard. Use a multiple of 3" from 9" to 48".',
        fix: [{ type: 'item.resize', id: 'item-0000', width: inches(30) }],
      },
    ]);
  });

  it('fails a filler wider than its range', () => {
    const [violation] = of('size.width-step', kitchen([on('filler.base', 'wall-north', 0, w(7))]));
    expect(violation!.message).toBe(
      'Base filler 7" at 0" on wall A: Width 7" is not allowed for filler.base. Use any width from 1/2" to 6".',
    );
    expect(violation!.fix).toEqual([{ type: 'item.resize', id: 'item-0000', width: inches(6) }]);
  });
});

describe('size.standard', () => {
  it('passes the standard height and depth', () => {
    expect(of('size.standard', kitchen([on('base.standard', 'wall-north', 0)]))).toEqual([]);
  });

  it('fails a height and a depth that are not standard, in one violation', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0, { height: inches(35), depth: inches(20) }),
    ]);
    expect(of('size.standard', doc)).toEqual([
      {
        ruleId: 'size.standard',
        severity: 'error',
        itemIds: ['item-0000'],
        message:
          'Base cabinet 30" at 0" on wall A: Height 35" is not standard for base.standard. Use 34 1/2". Depth 20" is not standard for base.standard. Use 24".',
      },
    ]);
  });
});

describe('item.catalog', () => {
  it('passes an item its catalog entry allows', () => {
    expect(of('item.catalog', kitchen([on('base.standard', 'wall-north', 0)]))).toEqual([]);
  });

  it('fails an item the catalog has no entry for, named by its kind', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0, { catalogId: 'nope' })]);
    const [violation, ...rest] = of('item.catalog', doc);
    expect(rest).toEqual([]);
    expect(violation).toMatchObject({ severity: 'error', itemIds: ['item-0000'] });
    expect(violation!.message).toMatch(
      /^Base cabinet 30" at 0" on wall A: The catalog has no entry "nope"\. Use base\.standard, /,
    );
  });

  it('fails an option the entry does not take and a placement it does not allow', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0, { options: { soft: true } }),
      free('wall.standard', 40, 40),
    ]);
    expect(of('item.catalog', doc).map((violation) => violation.message)).toEqual([
      'Base cabinet 30" at 0" on wall A: base.standard has no option "soft". Its options are doors, topDrawer or hinge.',
      'Wall cabinet 30" (free-standing): wall.standard cannot be placed "free". Use wall.',
    ]);
  });
});

describe('item.overlap', () => {
  it('passes items that touch, and a wall cabinet above a base cabinet', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 30),
      on('wall.standard', 'wall-north', 0),
      // Its back runs along the front of the first base cabinet.
      free('base.standard', 0, 24),
    ]);
    expect(of('item.overlap', doc)).toEqual([]);
  });

  it('fails two items that share a stretch of wall', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 24),
    ]);
    expect(of('item.overlap', doc)).toEqual([
      {
        ruleId: 'item.overlap',
        severity: 'error',
        itemIds: ['item-0000', 'item-0001'],
        message: 'Base cabinet 30" at 0" on wall A overlaps the base cabinet 30" at 24" on wall A.',
      },
    ]);
  });

  it('fails a free-standing item that overlaps one on a wall, at any rotation', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 36), free('base.drawers', 40, 10, 45)]);
    expect(of('item.overlap', doc)).toMatchObject([
      {
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Base cabinet 30" at 36" on wall A overlaps the drawer base cabinet 24" (free-standing).',
      },
    ]);
  });

  it('fails items on walls that do not meet, in a room too narrow for both', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 30), on('base.standard', 'wall-south', 84)],
      { depth: 40 },
    );
    expect(of('item.overlap', doc)).toHaveLength(1);
    expect(of('corner.conflict', doc)).toEqual([]);
  });

  it('ignores countertops', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0)], {
      countertops: [
        {
          wallId: 'wall-north',
          startOffset: 0,
          endOffset: inches(30),
          depth: inches(25.5),
          thickness: inches(1.5),
          elevation: inches(34),
        },
      ],
    });
    expect(of('item.overlap', doc)).toEqual([]);
  });
});

describe('item.outside-wall', () => {
  it('passes an item that ends exactly at the wall end', () => {
    expect(of('item.outside-wall', kitchen([on('base.standard', 'wall-north', 114)]))).toEqual([]);
  });

  it('fails an item that runs past the wall end and moves it back', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 120)]);
    const found = of('item.outside-wall', doc);
    expect(found).toEqual([
      {
        ruleId: 'item.outside-wall',
        severity: 'error',
        itemIds: ['item-0000'],
        message:
          'Base cabinet 30" at 120" on wall A ends at 150", past the end of wall A (144" long).',
        fix: [
          {
            type: 'item.move',
            id: 'item-0000',
            placement: { type: 'wall', wallId: 'wall-north', offset: inches(114) },
          },
        ],
      },
    ]);
    expect(of('item.outside-wall', fixed(doc, found[0]!))).toEqual([]);
  });

  it('has no fix for an item wider than its wall', () => {
    const [violation] = of(
      'item.outside-wall',
      kitchen([on('base.standard', 'wall-north', 0)], { width: 24 }),
    );
    expect(violation!.message).toContain('ends at 30", past the end of wall A (24" long)');
    expect(violation).not.toHaveProperty('fix');
  });
});

describe('item.outside-room', () => {
  it('passes an island inside the room, even with a side against a wall', () => {
    const doc = kitchen([free('base.standard', 40, 40), free('base.standard', 96, 0, 90)]);
    expect(of('item.outside-room', doc)).toEqual([]);
  });

  it('fails an island that crosses a wall', () => {
    expect(of('item.outside-room', kitchen([free('base.standard', -10, 40)]))).toEqual([
      {
        ruleId: 'item.outside-room',
        severity: 'error',
        itemIds: ['item-0000', 'wall-west'],
        message: 'Base cabinet 30" (free-standing) crosses wall D.',
      },
    ]);
  });

  it('fails an island outside a closed room', () => {
    expect(of('item.outside-room', kitchen([free('base.standard', 200, 40)]))).toEqual([
      {
        ruleId: 'item.outside-room',
        severity: 'error',
        itemIds: ['item-0000'],
        message: 'Base cabinet 30" (free-standing) is outside the room.',
      },
    ]);
  });

  it('has no outside while the room is open', () => {
    const doc = kitchen([free('base.standard', 200, 40)], { walls: 2 });
    expect(of('item.outside-room', doc)).toEqual([]);
  });
});

describe('item.exceeds-ceiling', () => {
  it('passes a tall cabinet that reaches the ceiling exactly', () => {
    const doc = kitchen([on('tall.pantry', 'wall-north', 0, { height: inches(96) })]);
    expect(of('item.exceeds-ceiling', doc)).toEqual([]);
  });

  it('fails an item above the ceiling, on a wall or free-standing', () => {
    const doc = kitchen([
      on('tall.pantry', 'wall-north', 0, { height: inches(96), elevation: inches(6) }),
      free('tall.pantry', 60, 60, 0, { elevation: inches(20) }),
    ]);
    expect(of('item.exceeds-ceiling', doc)).toEqual([
      {
        ruleId: 'item.exceeds-ceiling',
        severity: 'error',
        itemIds: ['item-0000'],
        message: 'Pantry cabinet 24" at 0" on wall A reaches 102", above the ceiling at 96".',
      },
      {
        ruleId: 'item.exceeds-ceiling',
        severity: 'error',
        itemIds: ['item-0001'],
        message: 'Pantry cabinet 24" (free-standing) reaches 104", above the ceiling at 96".',
      },
    ]);
  });

  it('fails an item above a wall that is lower than the ceiling', () => {
    const doc = kitchen([on('wall.standard', 'wall-north', 0)], {
      patch: (raw) => {
        raw.room.walls[0]!.height = inches(80);
      },
    });
    expect(of('item.exceeds-ceiling', doc).map((violation) => violation.message)).toEqual([
      'Wall cabinet 30" at 0" on wall A reaches 84", above the top of wall A at 80".',
    ]);
  });
});

describe('item.blocks-door', () => {
  const openings = [door('wall-north', 42, 32), passage('wall-east', 40, 36)];

  it('passes items that end where a door or passage starts', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 12), on('base.standard', 'wall-east', 76)],
      { openings },
    );
    expect(of('item.blocks-door', doc)).toEqual([]);
  });

  it('fails an item in front of a door', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 30)], { openings });
    expect(of('item.blocks-door', doc)).toEqual([
      {
        ruleId: 'item.blocks-door',
        severity: 'error',
        itemIds: ['item-0000', 'opening-00'],
        message: 'Base cabinet 30" at 30" on wall A overlaps the door at 42".',
      },
    ]);
  });

  it('fails an item in front of a passage, even above head height', () => {
    const doc = kitchen([on('wall.standard', 'wall-east', 60)], { openings });
    expect(of('item.blocks-door', doc).map((violation) => violation.message)).toEqual([
      'Wall cabinet 30" at 60" on wall B overlaps the passage at 40".',
    ]);
  });
});

describe('item.blocks-window', () => {
  it('passes a base cabinet below the sill, and one whose top is exactly at it', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 48), on('base.standard', 'wall-east', 48)],
      {
        openings: [windowAt('wall-north', 48, 36, 36), windowAt('wall-east', 48, 36, 34.5)],
      },
    );
    expect(of('item.blocks-window', doc)).toEqual([]);
  });

  it('passes a wall cabinet beside the window and a door below a cabinet', () => {
    const doc = kitchen([on('wall.standard', 'wall-north', 18)], {
      openings: [windowAt('wall-north', 48, 36), door('wall-east', 10, 32)],
    });
    expect(of('item.blocks-window', doc)).toEqual([]);
  });

  it('fails a wall cabinet in front of the window', () => {
    const doc = kitchen([on('wall.standard', 'wall-north', 48)], {
      openings: [windowAt('wall-north', 48, 36)],
    });
    expect(of('item.blocks-window', doc)).toEqual([
      {
        ruleId: 'item.blocks-window',
        severity: 'error',
        itemIds: ['item-0000', 'opening-00'],
        message:
          'Wall cabinet 30" at 48" on wall A overlaps the window at 48", whose sill is at 36".',
      },
    ]);
  });

  it('passes a cabinet that is wholly above a low window', () => {
    const doc = kitchen([on('wall.standard', 'wall-north', 48)], {
      openings: [windowAt('wall-north', 48, 36, 12, 42)],
    });
    expect(of('item.blocks-window', doc)).toEqual([]);
  });
});

describe('opening.invalid', () => {
  it('passes openings inside their wall that do not overlap', () => {
    const doc = kitchen([], {
      openings: [
        door('wall-north', 10, 32),
        windowAt('wall-north', 42, 36),
        // A transom above the door.
        windowAt('wall-north', 10, 32, 82, 12),
      ],
    });
    expect(of('opening.invalid', doc)).toEqual([]);
  });

  it('fails an opening that runs past its wall and one that reaches above it', () => {
    const doc = kitchen([], {
      openings: [door('wall-north', 130, 32), windowAt('wall-east', 20, 36, 60, 48)],
    });
    expect(of('opening.invalid', doc)).toEqual([
      {
        ruleId: 'opening.invalid',
        severity: 'error',
        itemIds: ['opening-00'],
        message: 'The door at 130" on wall A ends at 162", past the end of the wall (144" long).',
      },
      {
        ruleId: 'opening.invalid',
        severity: 'error',
        itemIds: ['opening-01'],
        message: 'The window at 20" on wall B reaches 108", above the wall (96" high).',
      },
    ]);
  });

  it('says both problems of one opening in one violation', () => {
    const doc = kitchen([], { openings: [windowAt('wall-north', 130, 36, 60, 48)] });
    expect(of('opening.invalid', doc).map((violation) => violation.message)).toEqual([
      'The window at 130" on wall A ends at 166", past the end of the wall (144" long) and reaches 108", above the wall (96" high).',
    ]);
  });

  it('fails two openings that overlap', () => {
    const doc = kitchen([], {
      openings: [door('wall-north', 10, 32), passage('wall-north', 30, 30)],
    });
    expect(of('opening.invalid', doc)).toEqual([
      {
        ruleId: 'opening.invalid',
        severity: 'error',
        itemIds: ['opening-00', 'opening-01'],
        message: 'The door at 10" on wall A overlaps the passage at 30".',
      },
    ]);
  });
});

describe('corner.conflict', () => {
  it('fails two 24 in deep base cabinets at the meeting ends of two walls', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 114),
      on('base.standard', 'wall-east', 0),
    ]);
    const found = of('corner.conflict', doc);
    expect(found).toEqual([
      {
        ruleId: 'corner.conflict',
        severity: 'error',
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Base cabinet 30" at 114" on wall A and the base cabinet 30" at 0" on wall B overlap in the corner where walls A and B meet.',
        fix: [
          {
            type: 'item.move',
            id: 'item-0001',
            placement: { type: 'wall', wallId: 'wall-east', offset: inches(24) },
          },
        ],
      },
    ]);
    expect(of('item.overlap', doc)).toEqual([]);
    // Moving one 24 in clear resolves it.
    expect(of('corner.conflict', fixed(doc, found[0]!))).toEqual([]);
  });

  it('passes a cabinet that starts where the other one ends, and a wall cabinet above', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 114),
      on('base.standard', 'wall-east', 24),
      on('wall.standard', 'wall-east', 0),
    ]);
    expect(of('corner.conflict', doc)).toEqual([]);
  });

  it('leaves a corner cabinet where it is and moves the other item back', () => {
    const doc = kitchen([
      on('base.corner.susan', 'wall-east', 0),
      on('base.standard', 'wall-north', 90),
    ]);
    const found = of('corner.conflict', doc);
    expect(found).toMatchObject([
      {
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Base cabinet 30" at 90" on wall A and the lazy Susan corner base 36" at 0" on wall B overlap in the corner where walls A and B meet.',
        fix: [
          {
            type: 'item.move',
            id: 'item-0001',
            placement: { type: 'wall', wallId: 'wall-north', offset: inches(78) },
          },
        ],
      },
    ]);
    expect(of('corner.conflict', fixed(doc, found[0]!))).toEqual([]);
  });

  it('moves the corner cabinet when the other item has nowhere to go', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 0, w(48)), on('base.corner.susan', 'wall-east', 0)],
      { width: 48 },
    );
    expect(of('corner.conflict', doc)[0]!.fix).toEqual([
      {
        type: 'item.move',
        id: 'item-0001',
        placement: { type: 'wall', wallId: 'wall-east', offset: inches(24) },
      },
    ]);
  });

  it('has no fix when neither item can move clear', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 0), on('base.standard', 'wall-east', 0)],
      { width: 30, depth: 30, walls: 2 },
    );
    const [violation] = of('corner.conflict', doc);
    expect(violation!.itemIds).toEqual(['item-0000', 'item-0001']);
    expect(violation).not.toHaveProperty('fix');
  });
});

describe('gap.needs-filler', () => {
  it('fails a 2 in gap between cabinets with a fix that adds a 2 in filler', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 32),
    ]);
    const found = of('gap.needs-filler', doc);
    expect(found).toEqual([
      {
        ruleId: 'gap.needs-filler',
        severity: 'warning',
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Base cabinet 30" at 0" on wall A is 2" from the base cabinet 30" at 32" on wall A. Add a 2" filler.',
        fix: [
          {
            type: 'item.add',
            item: {
              id: 'filler-01',
              catalogId: 'filler.base',
              kind: 'filler',
              width: inches(2),
              height: inches(34.5),
              depth: inches(0.75),
              elevation: 0,
              placement: { type: 'wall', wallId: 'wall-north', offset: inches(30) },
              options: {},
            },
          },
        ],
      },
    ]);
    // Applying the fix clears the violation.
    const after = fixed(doc, found[0]!);
    expect(of('gap.needs-filler', after)).toEqual([]);
    expect(validate(after, SEED_CATALOG).filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('fails a small gap to either end of the wall', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 2),
      on('base.standard', 'wall-north', 112),
    ]);
    expect(of('gap.needs-filler', doc).map(({ itemIds, message }) => [itemIds, message])).toEqual([
      [
        ['item-0000'],
        'Base cabinet 30" at 2" on wall A is 2" from the start of the wall. Add a 2" filler.',
      ],
      [
        ['item-0001'],
        'Base cabinet 30" at 112" on wall A is 2" from the end of the wall. Add a 2" filler.',
      ],
    ]);
  });

  it('gives each fix its own id, skipping ids in use', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 2),
      on('base.standard', 'wall-north', 112),
      (id) => ({ ...on('base.standard', 'wall-east', 40)(id), id: 'filler-01' }),
    ]);
    const ids = of('gap.needs-filler', doc).map((violation) => {
      const [command] = violation.fix!;
      return command!.type === 'item.add' && command.item.id;
    });
    expect(ids).toEqual(['filler-02', 'filler-03']);
  });

  it('has no fix for a gap wider than a filler or narrower than one', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 37),
      on('base.standard', 'wall-north', 67.25),
    ]);
    const found = of('gap.needs-filler', doc);
    expect(found.map((violation) => violation.message)).toEqual([
      'Base cabinet 30" at 0" on wall A is 7" from the base cabinet 30" at 37" on wall A. Close the gap, or widen it to at least 9" to fit a cabinet.',
      'Base cabinet 30" at 37" on wall A is 1/4" from the base cabinet 30" at 67 1/4" on wall A. Close the gap, or widen it to at least 9" to fit a cabinet.',
    ]);
    for (const violation of found) expect(violation).not.toHaveProperty('fix');
  });

  it('passes cabinets that touch, a 9 in gap and a gap beside an appliance only', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 9),
      on('base.standard', 'wall-north', 39),
      on('appliance.dishwasher', 'wall-north', 118),
      // At another height, so not a neighbour of the base cabinets.
      on('wall.standard', 'wall-north', 71),
      on('wall.standard', 'wall-north', 101),
    ]);
    expect(of('gap.needs-filler', doc)).toEqual([]);
  });

  it('fails a gap between a cabinet and an appliance on either side of it', () => {
    const doc = kitchen([
      on('appliance.range', 'wall-north', 0),
      on('base.standard', 'wall-north', 32),
      on('appliance.dishwasher', 'wall-north', 64),
    ]);
    expect(of('gap.needs-filler', doc).map(({ itemIds, message }) => [itemIds, message])).toEqual([
      [
        ['item-0001', 'item-0000'],
        'Base cabinet 30" at 32" on wall A is 2" from the range 30" at 0" on wall A. Add a 2" filler.',
      ],
      [
        ['item-0001', 'item-0002'],
        'Base cabinet 30" at 32" on wall A is 2" from the dishwasher 24" at 64" on wall A. Add a 2" filler.',
      ],
    ]);
  });

  it('fails a gap to the cabinet that comes round the corner from the wall before', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 114),
      on('base.standard', 'wall-east', 26),
    ]);
    const found = of('gap.needs-filler', doc);
    expect(found).toMatchObject([
      {
        itemIds: ['item-0001', 'item-0000'],
        message:
          'Base cabinet 30" at 26" on wall B is 2" from the base cabinet 30" at 114" on wall A. Add a 2" filler.',
      },
    ]);
    expect(of('gap.needs-filler', fixed(doc, found[0]!))).toEqual([]);
  });

  it('sizes the filler for the shorter neighbour', () => {
    const doc = kitchen([
      on('tall.pantry', 'wall-north', 0),
      on('base.standard', 'wall-north', 26),
      on('wall.standard', 'wall-east', 2),
    ]);
    const fillers = of('gap.needs-filler', doc).map((violation) => {
      const [command] = violation.fix!;
      if (command!.type !== 'item.add') throw new Error('expected item.add');
      const { catalogId, height, elevation } = command.item;
      return [catalogId, height, elevation];
    });
    expect(fillers).toEqual([
      ['filler.base', inches(34.5), 0],
      ['filler.wall', inches(30), inches(54)],
    ]);
  });
});

describe('clearance.door-swing', () => {
  // The south wall runs from east to west, so the door is 40 in from the east corner.
  const openings = [door('wall-south', 40, 32, 'in-left')];

  it('fails an island inside the swing of a door hinged on either side', () => {
    const doc = kitchen([free('base.standard', 70, 80)], { openings });
    expect(of('clearance.door-swing', doc)).toEqual([
      {
        ruleId: 'clearance.door-swing',
        severity: 'warning',
        itemIds: ['item-0000', 'opening-00'],
        message: 'Base cabinet 30" (free-standing) is in the swing of the door at 40" on wall C.',
      },
    ]);
    const right = kitchen([free('base.standard', 70, 80)], {
      openings: [door('wall-south', 40, 32, 'in-right')],
    });
    expect(of('clearance.door-swing', right)).toHaveLength(1);
  });

  it('passes cabinets against both jambs and an island clear of the swing', () => {
    const doc = kitchen(
      [
        on('base.standard', 'wall-south', 10),
        on('base.standard', 'wall-south', 72),
        free('base.standard', 60, 40),
        // In the corner of the square around the swing, but outside the quarter circle.
        free('filler.base', 73, 89, 0, w(1)),
      ],
      { openings },
    );
    expect(of('clearance.door-swing', doc)).toEqual([]);
  });

  it('passes items in every direction away from the door', () => {
    const doc = kitchen(
      [
        free('base.standard', 0, 40),
        free('base.standard', 110, 40, 90),
        free('base.standard', 60, 0),
        on('base.standard', 'wall-north', 0),
        on('base.standard', 'wall-east', 90),
        on('base.standard', 'wall-west', 0),
      ],
      { openings },
    );
    expect(of('clearance.door-swing', doc)).toEqual([]);
  });

  it('leaves an item in the doorway to item.blocks-door', () => {
    const doc = kitchen([on('base.standard', 'wall-south', 30)], { openings });
    expect(of('clearance.door-swing', doc)).toEqual([]);
    expect(of('item.blocks-door', doc)).toHaveLength(1);
  });

  it('passes a door that swings out, one with no swing and an item above the door', () => {
    const doc = kitchen(
      [
        free('base.standard', 70, 80),
        free('wall.standard', 70, 100, 0, { elevation: inches(84), height: inches(12) }),
      ],
      {
        openings: [
          door('wall-south', 40, 32, 'out-left'),
          door('wall-north', 40, 32),
          door('wall-south', 40, 32, 'in-left'),
        ],
      },
    );
    expect(of('clearance.door-swing', doc).map((violation) => violation.itemIds)).toEqual([
      ['item-0000', 'opening-02'],
    ]);
  });
});

describe('clearance.aisle', () => {
  it('fails an island less than 36 in from a run of cabinets', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 40), free('base.standard', 40, 54)]);
    expect(of('clearance.aisle', doc)).toEqual([
      {
        ruleId: 'clearance.aisle',
        severity: 'warning',
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Only 30" between the base cabinet 30" at 40" on wall A and the base cabinet 30" (free-standing). An aisle needs at least 36"; 42" is recommended.',
      },
    ]);
  });

  it('passes an island exactly 36 in away, and a wall cabinet nearer than that above it', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 40),
      on('wall.standard', 'wall-north', 40),
      free('base.standard', 40, 60),
    ]);
    expect(of('clearance.aisle', doc)).toEqual([]);
  });

  it('fails an island too near a wall, but not one that touches it', () => {
    const doc = kitchen([free('base.standard', 60, 80), free('base.standard', 0, 30, 270)]);
    expect(of('clearance.aisle', doc)).toEqual([
      {
        ruleId: 'clearance.aisle',
        severity: 'warning',
        itemIds: ['item-0000', 'wall-south'],
        message:
          'Only 16" between the base cabinet 30" (free-standing) and wall C. An aisle needs at least 36"; 42" is recommended.',
      },
    ]);
  });

  it('fails items across from each other on facing walls', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 30), on('base.standard', 'wall-south', 84)],
      { depth: 80 },
    );
    expect(of('clearance.aisle', doc)).toMatchObject([
      {
        itemIds: ['item-0000', 'item-0001'],
        message:
          'Only 32" between the base cabinet 30" at 30" on wall A and the base cabinet 30" at 84" on wall C. An aisle needs at least 36"; 42" is recommended.',
      },
    ]);
  });

  it('passes items on facing walls that are not across from each other', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 0), on('base.standard', 'wall-south', 0)],
      { depth: 80 },
    );
    expect(of('clearance.aisle', doc)).toEqual([]);
  });

  it('passes neighbours on one wall and items round a corner from each other', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 82),
      on('base.standard', 'wall-north', 114),
      on('base.standard', 'wall-east', 30),
      on('base.standard', 'wall-west', 0),
      on('base.standard', 'wall-south', 0),
    ]);
    expect(of('clearance.aisle', doc)).toEqual([]);
  });
});

describe('appliance.range-overhead', () => {
  it('fails a wall cabinet less than 30 in above a range', () => {
    const doc = kitchen([
      on('appliance.range', 'wall-north', 30),
      on('wall.standard', 'wall-north', 30),
    ]);
    expect(of('appliance.range-overhead', doc)).toEqual([
      {
        ruleId: 'appliance.range-overhead',
        severity: 'warning',
        itemIds: ['item-0001', 'item-0000'],
        message:
          'Wall cabinet 30" at 30" on wall A is only 18" above the range 30" at 30" on wall A. Leave at least 30" above a range, unless it is a hood.',
      },
    ]);
  });

  it('passes a hood, a cabinet at 66 in and a cabinet beside the range', () => {
    const doc = kitchen([
      on('appliance.range', 'wall-north', 30),
      on('appliance.hood', 'wall-north', 30, { elevation: inches(60) }),
      on('wall.standard', 'wall-north', 30, { elevation: inches(72), height: inches(12) }),
      on('wall.standard', 'wall-north', 60),
      on('base.standard', 'wall-north', 60),
    ]);
    expect(of('appliance.range-overhead', doc)).toEqual([]);
  });
});

describe('appliance.dishwasher-sink', () => {
  it('passes a dishwasher beside the sink, and one exactly 36 in from it', () => {
    const doc = kitchen([
      on('appliance.dishwasher', 'wall-north', 0),
      on('base.sink', 'wall-north', 24),
      on('appliance.dishwasher', 'wall-north', 96),
    ]);
    expect(of('appliance.dishwasher-sink', doc)).toEqual([]);
  });

  it('fails a dishwasher more than 36 in from the sink', () => {
    const doc = kitchen([
      on('appliance.dishwasher', 'wall-north', 0),
      on('base.sink', 'wall-north', 72),
    ]);
    expect(of('appliance.dishwasher-sink', doc)).toEqual([
      {
        ruleId: 'appliance.dishwasher-sink',
        severity: 'warning',
        itemIds: ['item-0000'],
        message: 'Dishwasher 24" at 0" on wall A is not within 36" of a sink base cabinet.',
      },
    ]);
  });

  it('fails a dishwasher in a design with no sink', () => {
    const doc = kitchen([on('appliance.dishwasher', 'wall-north', 0)]);
    expect(of('appliance.dishwasher-sink', doc)).toHaveLength(1);
  });
});

describe('appliance.fridge-door', () => {
  it('fails a refrigerator hard against the side wall at either corner', () => {
    const doc = kitchen([
      on('appliance.fridge', 'wall-north', 0),
      on('appliance.fridge', 'wall-north', 106),
    ]);
    expect(of('appliance.fridge-door', doc)).toEqual([
      {
        ruleId: 'appliance.fridge-door',
        severity: 'warning',
        itemIds: ['item-0000', 'wall-west'],
        message:
          'Refrigerator 36" at 0" on wall A is 0" from wall D. Leave at least 3" on the hinge side so the door opens fully.',
      },
      {
        ruleId: 'appliance.fridge-door',
        severity: 'warning',
        itemIds: ['item-0001', 'wall-east'],
        message:
          'Refrigerator 36" at 106" on wall A is 2" from wall B. Leave at least 3" on the hinge side so the door opens fully.',
      },
    ]);
  });

  it('passes a refrigerator 3 in from the side wall, and a free-standing one', () => {
    const doc = kitchen([
      on('appliance.fridge', 'wall-north', 3),
      free('appliance.fridge', 60, 60),
    ]);
    expect(of('appliance.fridge-door', doc)).toEqual([]);
  });

  it('checks only the hinge side when the item says which it is', () => {
    const hinged = (hinge: string) =>
      kitchen([on('appliance.fridge', 'wall-north', 0, { options: { hinge } })]);
    expect(of('appliance.fridge-door', hinged('right'))).toEqual([]);
    expect(of('appliance.fridge-door', hinged('left'))).toHaveLength(1);
  });

  it('passes where no wall meets the corner, or the wall there turns away', () => {
    const alone = kitchen([on('appliance.fridge', 'wall-north', 0)], { walls: 1 });
    expect(of('appliance.fridge-door', alone)).toEqual([]);
    // The wall before the north wall now runs on in the same line instead of coming in.
    const straight = kitchen([on('appliance.fridge', 'wall-north', 0)], {
      patch: (raw) => {
        raw.room.walls[3]!.start = { x: -inches(120), y: 0 };
      },
    });
    expect(of('appliance.fridge-door', straight)).toEqual([]);
  });
});

describe('wall.alignment', () => {
  it('passes wall cabinets whose tops are level, whatever their heights', () => {
    const doc = kitchen([
      on('wall.standard', 'wall-north', 0),
      on('wall.fridge', 'wall-north', 30),
      on('wall.standard', 'wall-east', 30, { height: inches(36) }),
      on('base.standard', 'wall-north', 0),
    ]);
    expect(of('wall.alignment', doc)).toEqual([]);
  });

  it('fails tops at different heights and raises the low cabinets', () => {
    const doc = kitchen([
      on('wall.standard', 'wall-north', 0),
      on('wall.standard', 'wall-north', 30, { height: inches(36) }),
    ]);
    const found = of('wall.alignment', doc);
    expect(found).toEqual([
      {
        ruleId: 'wall.alignment',
        severity: 'info',
        itemIds: ['item-0000'],
        message: 'Wall cabinets on wall A have tops at 84" and 90". Align them at 90".',
        fix: [
          {
            type: 'item.move',
            id: 'item-0000',
            placement: { type: 'wall', wallId: 'wall-north', offset: 0 },
            elevation: inches(60),
          },
        ],
      },
    ]);
    expect(of('wall.alignment', fixed(doc, found[0]!))).toEqual([]);
  });
});

describe('countertop.coverage', () => {
  const top = (startOffset: number, endOffset: number, wallId = 'wall-north') => ({
    wallId,
    startOffset: inches(startOffset),
    endOffset: inches(endOffset),
    depth: inches(25.5),
    thickness: inches(1.5),
    elevation: inches(34.5),
  });

  it('fails a base run with no countertop and proposes one', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.sink', 'wall-north', 30),
      on('wall.standard', 'wall-north', 0),
    ]);
    const found = of('countertop.coverage', doc);
    expect(found).toEqual([
      {
        ruleId: 'countertop.coverage',
        severity: 'info',
        itemIds: ['item-0000', 'item-0001', 'wall-north'],
        message: 'The base run on wall A from 0" to 66" has no countertop.',
        fix: [{ type: 'countertop.add', countertop: { id: 'countertop-01', ...top(0, 66) } }],
      },
    ]);
    expect(of('countertop.coverage', fixed(doc, found[0]!))).toEqual([]);
  });

  it('passes a run under a countertop, with or without an overhang at its ends', () => {
    const doc = kitchen(
      [on('base.standard', 'wall-north', 12), on('base.standard', 'wall-east', 30)],
      { countertops: [top(12, 42), top(28.5, 61.5, 'wall-east')] },
    );
    expect(of('countertop.coverage', doc)).toEqual([]);
  });

  it('fails a run that a countertop covers only in part, with no fix', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0)], { countertops: [top(0, 20)] });
    const found = of('countertop.coverage', doc);
    expect(found.map((violation) => violation.message)).toEqual([
      'The base run on wall A from 0" to 30" is only partly covered by a countertop.',
    ]);
    expect(found[0]).not.toHaveProperty('fix');
  });

  it('fails a countertop that extends past the cabinets under it', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0)], {
      countertops: [top(0, 60), top(0, 30, 'wall-east')],
    });
    expect(of('countertop.coverage', doc)).toEqual([
      {
        ruleId: 'countertop.coverage',
        severity: 'info',
        itemIds: ['top-0000'],
        message: 'The countertop on wall A from 0" to 60" extends past the cabinets under it.',
      },
      {
        ruleId: 'countertop.coverage',
        severity: 'info',
        itemIds: ['top-0001'],
        message: 'The countertop on wall B from 0" to 30" extends past the cabinets under it.',
      },
    ]);
  });

  it('asks for no countertop over a run the corner trims to nothing', () => {
    const doc = kitchen([
      on('filler.base', 'wall-north', 141),
      on('base.standard', 'wall-east', 0),
    ]);
    expect(of('countertop.coverage', doc).map((violation) => violation.itemIds)).toEqual([
      ['item-0001', 'wall-east'],
    ]);
  });
});

describe('room.open', () => {
  it('passes a closed room and a document with no walls yet', () => {
    expect(of('room.open', kitchen())).toEqual([]);
    expect(of('room.open', kitchen([], { walls: 0 }))).toEqual([]);
  });

  it('fails walls that stop short of closing, naming where', () => {
    expect(of('room.open', kitchen([], { walls: 3 }))).toEqual([
      {
        ruleId: 'room.open',
        severity: 'info',
        itemIds: ['wall-south'],
        message: 'The room is open: wall C does not end where the next wall starts.',
      },
    ]);
  });

  it('fails two walls that run out and back', () => {
    const doc = kitchen([], {
      walls: 2,
      patch: (raw) => {
        raw.room.walls[1]!.end = { x: 0, y: 0 };
      },
    });
    expect(of('room.open', doc)).toEqual([
      {
        ruleId: 'room.open',
        severity: 'info',
        itemIds: ['wall-north'],
        message: 'The room is open: it takes at least three walls to close it.',
      },
    ]);
  });
});

describe('layout.work-triangle', () => {
  it('passes a triangle between 156 in and 312 in, and a design missing a corner of it', () => {
    const doc = kitchen([
      on('base.sink', 'wall-north', 54),
      on('appliance.range', 'wall-east', 40),
      on('appliance.fridge', 'wall-west', 30),
    ]);
    expect(of('layout.work-triangle', doc)).toEqual([]);
    const noFridge = kitchen([
      on('base.sink', 'wall-north', 0),
      on('appliance.range', 'wall-north', 36),
    ]);
    expect(of('layout.work-triangle', noFridge)).toEqual([]);
  });

  it('fails a triangle that is too tight', () => {
    const doc = kitchen([
      on('base.sink', 'wall-north', 0),
      on('appliance.range', 'wall-north', 36),
      on('appliance.fridge', 'wall-north', 66),
    ]);
    expect(of('layout.work-triangle', doc)).toEqual([
      {
        ruleId: 'layout.work-triangle',
        severity: 'info',
        itemIds: ['item-0000', 'item-0001', 'item-0002'],
        message:
          'The work triangle between the sink, range and refrigerator is 132 1/8" around, under the recommended 156" to 312".',
      },
    ]);
  });

  it('fails a triangle that is too spread out', () => {
    const doc = kitchen([
      on('base.sink', 'wall-north', 0),
      on('appliance.range', 'wall-east', 90),
      on('appliance.fridge', 'wall-west', 0),
    ]);
    const [violation] = of('layout.work-triangle', doc);
    expect(violation!.message).toMatch(/is 3\d\d[^"]*" around, over the recommended/);
  });
});

describe('fixes', () => {
  it('are commands the catalog accepts', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 2, w(31)),
      on('base.standard', 'wall-north', 120),
      on('wall.standard', 'wall-north', 0),
      on('wall.standard', 'wall-north', 30, { height: inches(36) }),
      on('base.standard', 'wall-east', 0),
    ]);
    const fixes = validate(doc, SEED_CATALOG).flatMap((violation) => violation.fix ?? []);
    expect(fixes.length).toBeGreaterThan(4);
    for (const command of fixes as Command[]) {
      expect(applyCommand(doc, command, { catalog: SEED_CATALOG }).ok).toBe(true);
    }
  });
});
