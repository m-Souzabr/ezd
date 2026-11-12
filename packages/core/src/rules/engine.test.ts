import { describe, expect, it } from 'vitest';

import { defaultItemFor, getEntry, SEED_CATALOG } from '../catalog/index.js';
import type { DesignDocument } from '../document/index.js';
import { clone } from '../test/fixtures.js';
import { door, free, kitchen, on } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { itemLabel, validate, validateCommand, wallLabel } from './index.js';

const messy = () =>
  kitchen(
    [
      on('wall.standard', 'wall-north', 30, { height: inches(36) }),
      on('wall.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 24),
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 114),
      on('base.standard', 'wall-east', 2, { width: inches(31) }),
      on('appliance.dishwasher', 'wall-east', 60),
      free('base.standard', 200, 40),
    ],
    { walls: 3, openings: [door('wall-east', 70, 32)] },
  );

describe('validate', () => {
  it('sorts by severity, then rule id, then item ids', () => {
    const found = validate(messy(), SEED_CATALOG);
    const rank = { error: 0, warning: 1, info: 2 };
    const keys = found.map((v) => [rank[v.severity], v.ruleId, v.itemIds.join()] as const);
    const sorted = [...keys].sort(
      (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : 1),
    );
    expect(keys).toEqual(sorted);
    expect(new Set(found.map((violation) => violation.severity))).toEqual(
      new Set(['error', 'warning', 'info']),
    );
    expect(found.map((violation) => violation.ruleId)).toEqual([
      'corner.conflict',
      'item.blocks-door',
      'item.overlap',
      'size.width-step',
      'appliance.dishwasher-sink',
      'gap.needs-filler',
      'countertop.coverage',
      'countertop.coverage',
      'countertop.coverage',
      'countertop.coverage',
      'room.open',
      'wall.alignment',
    ]);
  });

  it('breaks ties between violations of one rule on the same items by message', () => {
    // Each cabinet is 2 in from the other on both of its sides, round the two-wall "room".
    const doc = kitchen(
      [on('base.standard', 'wall-north', 0), on('base.standard', 'wall-north', 32)],
      { width: 62, walls: 1 },
    );
    const found = validate(doc, SEED_CATALOG).filter((v) => v.ruleId === 'gap.needs-filler');
    expect(found.map((violation) => violation.message)).toEqual(
      [...found.map((v) => v.message)].sort(),
    );
  });

  it('is deterministic and leaves the document alone', () => {
    const doc = messy();
    const before = clone(doc);
    const first = validate(doc, SEED_CATALOG);
    expect(validate(doc, SEED_CATALOG)).toEqual(first);
    expect(validate(messy(), SEED_CATALOG)).toEqual(first);
    expect(doc).toEqual(before);
  });

  it('finds nothing in an empty document', () => {
    expect(validate(kitchen([], { walls: 0 }), SEED_CATALOG)).toEqual([]);
  });

  it('passes over an item on a wall the document does not have', () => {
    const broken = clone(kitchen([on('base.standard', 'wall-north', 0)])) as DesignDocument;
    const item = broken.items[0]!;
    if (item.placement.type === 'wall') item.placement.wallId = 'wall-nowhere';
    expect(validate(broken, SEED_CATALOG)).toEqual([]);
  });
});

describe('validateCommand', () => {
  const base = (id: string, offset: number) =>
    defaultItemFor(getEntry(SEED_CATALOG, 'base.standard')!, id, {
      type: 'wall',
      wallId: 'wall-north',
      offset: inches(offset),
    });

  it('returns the new document, all its violations and only the new ones as introduced', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 24),
    ]);
    const result = validateCommand(doc, SEED_CATALOG, {
      type: 'item.add',
      item: base('item-new-01', 100),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.doc.items).toHaveLength(3);
    expect(result.value.violations).toEqual(validate(result.value.doc, SEED_CATALOG));
    expect(result.value.violations.map((violation) => violation.ruleId)).toEqual([
      'item.overlap',
      'countertop.coverage',
      'countertop.coverage',
    ]);
    expect(result.value.introduced).toEqual([
      {
        ruleId: 'countertop.coverage',
        severity: 'info',
        itemIds: ['item-new-01', 'wall-north'],
        message: 'The base run on wall A from 100" to 130" has no countertop.',
        fix: [expect.objectContaining({ type: 'countertop.add' })],
      },
    ]);
  });

  it('introduces nothing when the command changes nothing the rules look at', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 24),
    ]);
    const result = validateCommand(doc, SEED_CATALOG, { type: 'document.rename', name: 'Renamed' });
    expect(result.ok && result.value.introduced).toEqual([]);
    expect(result.ok && result.value.violations.length).toBe(2);
  });

  it('applies a command that introduces errors and reports them', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 0)]);
    const result = validateCommand(doc, SEED_CATALOG, {
      type: 'item.add',
      item: base('item-new-01', 12),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.doc.items.map((item) => item.id)).toEqual(['item-0000', 'item-new-01']);
    expect(result.value.introduced.filter((v) => v.severity === 'error')).toEqual([
      {
        ruleId: 'item.overlap',
        severity: 'error',
        itemIds: ['item-0000', 'item-new-01'],
        message: 'Base cabinet 30" at 0" on wall A overlaps the base cabinet 30" at 12" on wall A.',
      },
    ]);
  });

  it('matches violations on the rule and the items, whatever their order', () => {
    // Swapping the two items reverses the order the overlap lists them in.
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 24),
    ]);
    const result = validateCommand(doc, SEED_CATALOG, {
      type: 'batch',
      commands: [
        { type: 'item.remove', id: 'item-0000' },
        { type: 'item.add', item: doc.items[0]! },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const overlap = result.value.violations.find((v) => v.ruleId === 'item.overlap');
    expect(overlap!.itemIds).toEqual(['item-0001', 'item-0000']);
    expect(result.value.introduced.map((v) => v.ruleId)).not.toContain('item.overlap');
  });

  it('fails as applyCommand does, checking items against the catalog', () => {
    const doc = kitchen();
    const missing = validateCommand(doc, SEED_CATALOG, { type: 'item.remove', id: 'item-9999' });
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const offStep = validateCommand(doc, SEED_CATALOG, {
      type: 'item.add',
      item: { ...base('item-new-01', 0), width: inches(31) },
    });
    expect(offStep).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', constraintErrors: [{ code: 'WIDTH_OFF_STEP' }] },
    });
  });
});

describe('wallLabel', () => {
  it('labels walls A, B, C in document order', () => {
    const doc = kitchen();
    expect(doc.room.walls.map((wall) => wallLabel(doc, wall.id))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('carries on with AA after Z, and gives ? for a wall the document does not have', () => {
    const doc = kitchen([], {
      patch: (raw) => {
        for (let i = 4; i < 28; i += 1) {
          raw.room.walls.push({
            id: `wall-extra-${i}`,
            start: { x: i, y: 5000 },
            end: { x: i + 1, y: 5000 },
            thickness: 72,
          });
        }
      },
    });
    expect(wallLabel(doc, 'wall-extra-25')).toBe('Z');
    expect(wallLabel(doc, 'wall-extra-26')).toBe('AA');
    expect(wallLabel(doc, 'wall-extra-27')).toBe('AB');
    expect(wallLabel(doc, 'wall-nowhere')).toBe('?');
  });
});

describe('itemLabel', () => {
  it('names an item by its catalog name, width and place on its wall', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 12),
      on('base.corner.susan', 'wall-east', 0),
      free('base.standard', 48, 48),
    ]);
    expect(doc.items.map((item) => itemLabel(doc, SEED_CATALOG, item))).toEqual([
      'Base cabinet 30" at 12" on wall A',
      // The seed name says how the corner is measured, in brackets. The label leaves it out.
      'Lazy Susan corner base 36" at 0" on wall B',
      'Base cabinet 30" (free-standing)',
    ]);
  });

  it('falls back to the kind for an item the catalog does not have', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 12, { catalogId: 'base.custom' })]);
    expect(itemLabel(doc, SEED_CATALOG, doc.items[0]!)).toBe('Base cabinet 30" at 12" on wall A');
    expect(itemLabel(doc, { ...SEED_CATALOG, entries: [] }, doc.items[0]!)).toBe(
      'Base cabinet 30" at 12" on wall A',
    );
  });
});
