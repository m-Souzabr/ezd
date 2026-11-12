import { describe, expect, it } from 'vitest';

import type { Item } from '../document/index.js';
import { inches, STEP } from '../units/index.js';
import {
  allowedOptionValues,
  allowedWidths,
  BACKSPLASH_HEIGHT,
  BASE_CABINET_HEIGHT,
  type Catalog,
  type CatalogEntry,
  checkItemAgainstCatalog,
  type ConstraintCode,
  COUNTER_HEIGHT,
  COUNTERTOP_DEPTH,
  COUNTERTOP_THICKNESS,
  defaultItemFor,
  getEntry,
  nearestAllowedWidth,
  SEED_CATALOG,
  SEED_FINISHES,
  WALL_CABINET_ELEVATION,
} from './index.js';

const entries = SEED_CATALOG.entries;
const fillers = entries.filter((entry) => entry.kind === 'filler');
// An end panel is as wide as it is thick, so it is the one entry off the 3 in grid that
// is not a filler.
const onGrid = entries.filter((entry) => entry.kind !== 'filler' && entry.kind !== 'panel');
const notFillers = entries.filter((entry) => entry.kind !== 'filler');

const entryOf = (id: string): CatalogEntry => {
  const entry = getEntry(SEED_CATALOG, id);
  if (!entry) throw new Error(`no entry ${id}`);
  return entry;
};
const onWall = { type: 'wall', wallId: 'wall-north', offset: 0 } as const;
/** The entry's default item, on a wall, with some fields replaced. */
const itemOf = (id: string, overrides: Partial<Item> = {}): Item => ({
  ...defaultItemFor(entryOf(id), 'item-000001', onWall),
  ...overrides,
});
const codes = (item: Item, catalog: Catalog = SEED_CATALOG): ConstraintCode[] =>
  checkItemAgainstCatalog(item, catalog).map((error) => error.code);

describe('constants', () => {
  it('a base cabinet plus its countertop is 36 in high', () => {
    expect(BASE_CABINET_HEIGHT + COUNTERTOP_THICKNESS).toBe(inches(36));
    expect(COUNTER_HEIGHT).toBe(inches(36));
    expect(COUNTERTOP_DEPTH).toBe(inches(25.5));
  });

  it('wall cabinets start a backsplash above the counter', () => {
    expect(COUNTER_HEIGHT + BACKSPLASH_HEIGHT).toBe(WALL_CABINET_ELEVATION);
  });
});

describe('seed catalog', () => {
  it('has the 19 entries, with unique ids', () => {
    const ids = entries.map((entry) => entry.id);
    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
  });

  it('stores every length as a positive integer', () => {
    for (const entry of entries) {
      const lengths = [
        ...allowedWidths(entry),
        ...entry.heights,
        ...entry.depths,
        ...Object.values(entry.defaultSize),
      ];
      expect(lengths.every((len) => Number.isSafeInteger(len) && len > 0)).toBe(true);
      expect(Number.isSafeInteger(entry.defaultElevation)).toBe(true);
      expect(entry.defaultElevation).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every cabinet and appliance width on the 3 in grid', () => {
    for (const entry of onGrid) {
      expect(allowedWidths(entry).every((width) => width % STEP === 0)).toBe(true);
    }
    expect(allowedWidths(entryOf('panel.end'))).toEqual([inches(0.75)]);
  });

  it('uses a free width for fillers only', () => {
    expect(fillers.map((entry) => entry.id)).toEqual(['filler.base', 'filler.wall', 'filler.tall']);
    for (const entry of entries) {
      expect('free' in entry.width).toBe(entry.kind === 'filler');
    }
  });

  it('gives corner entries a shape, and says in the name which wall each dimension follows', () => {
    for (const entry of entries) {
      expect(entry.corner !== undefined).toBe(entry.kind === 'corner');
      if (entry.kind === 'corner') expect(entry.name).toMatch(/width along its own wall/);
    }
  });

  it('stores prices as whole cents', () => {
    for (const { price } of entries) {
      const cents = [
        price.baseCents,
        price.perInchWidthCents,
        ...Object.values(price.optionCents ?? {}),
      ];
      expect(cents.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    }
  });

  it('has at least 8 finishes with unique ids and hex colours, covering every target', () => {
    expect(SEED_CATALOG.finishes).toBe(SEED_FINISHES);
    expect(SEED_FINISHES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SEED_FINISHES.map((finish) => finish.id)).size).toBe(SEED_FINISHES.length);
    for (const finish of SEED_FINISHES) expect(finish.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(SEED_FINISHES.map((finish) => finish.target))).toEqual(
      new Set(['cabinet', 'countertop', 'wall', 'floor']),
    );
  });
});

describe('getEntry, allowedWidths, defaultItemFor', () => {
  it('finds an entry by id', () => {
    expect(getEntry(SEED_CATALOG, 'base.sink')?.name).toBe('Sink base cabinet');
    expect(getEntry(SEED_CATALOG, 'base.missing')).toBeUndefined();
  });

  it('lists stepped, listed and free widths in ascending order', () => {
    expect(allowedWidths(entryOf('base.sink'))).toEqual([24, 27, 30, 33, 36, 39, 42].map(inches));
    expect(allowedWidths(entryOf('appliance.range'))).toEqual([30, 36].map(inches));
    const filler = allowedWidths(entryOf('filler.base'));
    expect(filler).toHaveLength(89);
    expect(filler[0]).toBe(inches(0.5));
    expect(filler.at(-1)).toBe(inches(6));
    const unsorted = { ...entryOf('appliance.range'), width: { values: [576, 480] } };
    expect(allowedWidths(unsorted)).toEqual([480, 576]);
  });

  it('builds the default item: default size, elevation and options', () => {
    expect(defaultItemFor(entryOf('wall.standard'), 'item-000001', onWall)).toEqual({
      id: 'item-000001',
      catalogId: 'wall.standard',
      kind: 'wall',
      width: inches(30),
      height: inches(30),
      depth: inches(12),
      elevation: inches(54),
      placement: onWall,
      options: { doors: 2, hinge: 'left' },
    });
    expect(defaultItemFor(entryOf('base.standard'), 'item-000001').placement).toEqual({
      type: 'free',
      x: 0,
      y: 0,
      rotation: 0,
    });
  });

  it.each(entries)('the default item of $id passes its own constraints', (entry) => {
    expect(
      checkItemAgainstCatalog(defaultItemFor(entry, 'item-000001', onWall), SEED_CATALOG),
    ).toEqual([]);
    if (entry.placement.includes('free')) {
      expect(checkItemAgainstCatalog(defaultItemFor(entry, 'item-000001'), SEED_CATALOG)).toEqual(
        [],
      );
    }
  });
});

describe('checkItemAgainstCatalog', () => {
  describe.each(notFillers)('widths of $id', (entry) => {
    // Corner entries that must be square take their depth from the width.
    const sized = (width: number): Item =>
      itemOf(entry.id, {
        width,
        ...((entry.corner === 'l' || entry.corner === 'diagonal') && { depth: width }),
      });
    const widthCodes = (width: number) =>
      codes(sized(width)).filter((code) => code.startsWith('WIDTH'));
    const widths = allowedWidths(entry);

    it('accepts each allowed width', () => {
      for (const width of widths) expect(codes(sized(width))).toEqual([]);
    });

    it('rejects each allowed width plus one inch with WIDTH_OFF_STEP', () => {
      for (const width of widths) expect(widthCodes(width + inches(1))).toEqual(['WIDTH_OFF_STEP']);
    });

    it('rejects a width below the minimum or above the maximum with WIDTH_OUT_OF_RANGE', () => {
      const below = Math.ceil(widths[0]! / STEP) * STEP - STEP;
      const above = Math.floor(widths.at(-1)! / STEP) * STEP + STEP;
      if (below > 0) expect(widthCodes(below)).toEqual(['WIDTH_OUT_OF_RANGE']);
      expect(widthCodes(above)).toEqual(['WIDTH_OUT_OF_RANGE']);
    });
  });

  it('rejects a width on the grid that the entry does not come in', () => {
    expect(codes(itemOf('appliance.range', { width: inches(33) }))).toEqual(['WIDTH_OUT_OF_RANGE']);
  });

  it.each(fillers)('$id accepts any sixteenth from 1/2 in to 6 in', (entry) => {
    for (const width of [inches(0.5), inches(1) + 5, inches(6)]) {
      expect(codes(itemOf(entry.id, { width }))).toEqual([]);
    }
    for (const width of [inches(0.25), inches(6.5)]) {
      expect(codes(itemOf(entry.id, { width }))).toEqual(['WIDTH_OUT_OF_RANGE']);
    }
  });

  it.each(['base.standard', 'wall.standard', 'tall.pantry'])(
    '%s rejects a non-standard height or depth',
    (id) => {
      const item = itemOf(id);
      expect(codes({ ...item, height: item.height + inches(1) })).toEqual(['HEIGHT_NOT_STANDARD']);
      expect(codes({ ...item, depth: item.depth + inches(1) })).toEqual(['DEPTH_NOT_STANDARD']);
    },
  );

  it('accepts every standard height and depth', () => {
    for (const entry of entries) {
      for (const height of entry.heights) expect(codes(itemOf(entry.id, { height }))).toEqual([]);
    }
    expect(codes(itemOf('tall.pantry', { depth: inches(12) }))).toEqual([]);
  });

  it('requires an L or diagonal corner to be as deep as it is wide', () => {
    expect(codes(itemOf('base.corner.susan', { width: inches(33), depth: inches(33) }))).toEqual(
      [],
    );
    const [error] = checkItemAgainstCatalog(
      itemOf('base.corner.susan', { width: inches(33) }),
      SEED_CATALOG,
    );
    expect(error).toMatchObject({ code: 'DEPTH_NOT_STANDARD', allowed: [inches(33)] });
    expect(error?.message).toBe('Depth 36" must match the width for base.corner.susan. Use 33".');
  });

  it('says what to use instead, and lists the allowed values', () => {
    const check = (id: string, overrides: Partial<Item>) =>
      checkItemAgainstCatalog(itemOf(id, overrides), SEED_CATALOG)[0];
    expect(check('base.standard', { width: inches(31) })).toEqual({
      code: 'WIDTH_OFF_STEP',
      message: 'Width 31" is not allowed for base.standard. Use a multiple of 3" from 9" to 48".',
      allowed: allowedWidths(entryOf('base.standard')),
    });
    expect(check('appliance.fridge', { width: inches(39) })?.message).toBe(
      'Width 39" is not allowed for appliance.fridge. Use 30", 33" or 36".',
    );
    expect(check('panel.end', { width: inches(1) })?.message).toBe(
      'Width 1" is not allowed for panel.end. Use 3/4".',
    );
    expect(check('filler.base', { width: inches(6.5) })?.message).toBe(
      'Width 6 1/2" is not allowed for filler.base. Use any width from 1/2" to 6".',
    );
    expect(check('tall.pantry', { height: inches(80) })).toEqual({
      code: 'HEIGHT_NOT_STANDARD',
      message: 'Height 80" is not standard for tall.pantry. Use 84", 90" or 96".',
      allowed: [84, 90, 96].map(inches),
    });
    expect(check('tall.pantry', { depth: inches(18) })).toEqual({
      code: 'DEPTH_NOT_STANDARD',
      message: 'Depth 18" is not standard for tall.pantry. Use 12" or 24".',
      allowed: [12, 24].map(inches),
    });
  });

  it('rejects an unknown catalog id on its own', () => {
    const errors = checkItemAgainstCatalog(
      itemOf('base.standard', { catalogId: 'base.custom', width: 1 }),
      SEED_CATALOG,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'UNKNOWN_CATALOG_ID' });
    expect(errors[0]?.allowed).toContain('base.standard');
    expect(errors[0]?.message).toContain('"base.custom"');
  });

  it('rejects a kind that is not the entry kind', () => {
    const [error] = checkItemAgainstCatalog(
      itemOf('base.standard', { kind: 'wall' }),
      SEED_CATALOG,
    );
    expect(error).toEqual({
      code: 'KIND_MISMATCH',
      message: 'base.standard is of kind "base", not "wall".',
      allowed: ['base'],
    });
  });

  it('rejects a placement the entry does not allow', () => {
    const free = { type: 'free', x: 0, y: 0, rotation: 0 } as const;
    expect(codes(itemOf('base.standard', { placement: free }))).toEqual([]);
    const [error] = checkItemAgainstCatalog(
      itemOf('wall.standard', { placement: free }),
      SEED_CATALOG,
    );
    expect(error).toEqual({
      code: 'PLACEMENT_NOT_ALLOWED',
      message: 'wall.standard cannot be placed "free". Use wall.',
      allowed: ['wall'],
    });
  });

  it('checks options: unknown keys, wrong types and values not offered', () => {
    const check = (id: string, options: Item['options']) =>
      checkItemAgainstCatalog(itemOf(id, { options }), SEED_CATALOG);
    // Left out, an option takes its default.
    expect(check('base.standard', {})).toEqual([]);
    expect(check('base.standard', { doors: 1, topDrawer: false, hinge: 'right' })).toEqual([]);
    expect(check('base.standard', { doors: 3 })).toEqual([
      {
        code: 'OPTION_INVALID',
        message: 'Option "doors" of base.standard cannot be 3. Use 1 or 2.',
        allowed: [1, 2],
        option: 'doors',
      },
    ]);
    expect(check('base.standard', { doors: '2', topDrawer: 'yes', hinge: 'top' })).toMatchObject([
      { option: 'doors', allowed: [1, 2] },
      { option: 'topDrawer', allowed: [true, false] },
      { option: 'hinge', allowed: ['left', 'right'] },
    ]);
    expect(check('base.standard', { softClose: true })).toEqual([
      {
        code: 'OPTION_INVALID',
        message:
          'base.standard has no option "softClose". Its options are doors, topDrawer or hinge.',
        allowed: ['doors', 'topDrawer', 'hinge'],
        option: 'softClose',
      },
    ]);
    expect(check('filler.base', { doors: 1 })[0]?.message).toBe(
      'filler.base has no options, so "doors" is not allowed.',
    );
  });

  it('supports an integer option given as a range', () => {
    const shelves = { key: 'shelves', type: 'int', range: { min: 0, max: 3 }, default: 1 } as const;
    expect(allowedOptionValues(shelves)).toEqual([0, 1, 2, 3]);
    const catalog: Catalog = {
      ...SEED_CATALOG,
      entries: [{ ...entryOf('wall.standard'), options: [shelves] }],
    };
    expect(codes(itemOf('wall.standard', { options: { shelves: 3 } }), catalog)).toEqual([]);
    expect(codes(itemOf('wall.standard', { options: { shelves: 4 } }), catalog)).toEqual([
      'OPTION_INVALID',
    ]);
    expect(codes(itemOf('wall.standard', { options: { shelves: 1.5 } }), catalog)).toEqual([
      'OPTION_INVALID',
    ]);
  });

  it('reports every problem at once', () => {
    const item = itemOf('base.standard', {
      width: inches(8),
      height: inches(30),
      depth: inches(20),
      options: { doors: 0 },
    });
    expect(codes(item)).toEqual([
      'WIDTH_OFF_STEP',
      'HEIGHT_NOT_STANDARD',
      'DEPTH_NOT_STANDARD',
      'OPTION_INVALID',
    ]);
  });
});

describe('nearestAllowedWidth', () => {
  it('snaps to the closest allowed width, the narrower one on a tie', () => {
    const base = entryOf('base.standard');
    expect(nearestAllowedWidth(base, inches(31))).toBe(inches(30));
    expect(nearestAllowedWidth(base, inches(32))).toBe(inches(33));
    expect(nearestAllowedWidth(base, inches(31.5))).toBe(inches(30));
    expect(nearestAllowedWidth(base, inches(2))).toBe(inches(9));
    expect(nearestAllowedWidth(base, inches(80))).toBe(inches(48));
    expect(nearestAllowedWidth(entryOf('appliance.range'), inches(34))).toBe(inches(36));
  });

  it('clamps a filler to its range and keeps any sixteenth inside it', () => {
    const filler = entryOf('filler.wall');
    expect(nearestAllowedWidth(filler, inches(1) + 5)).toBe(inches(1) + 5);
    expect(nearestAllowedWidth(filler, 3)).toBe(inches(0.5));
    expect(nearestAllowedWidth(filler, inches(9))).toBe(inches(6));
  });

  it.each(entries)('returns an allowed width of $id for any input', (entry) => {
    const widths = allowedWidths(entry);
    for (let width = -8; width <= inches(60); width += 7) {
      expect(widths).toContain(nearestAllowedWidth(entry, width));
    }
  });
});
