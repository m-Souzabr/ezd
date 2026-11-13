import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Catalog, SEED_CATALOG } from '../catalog/index.js';
import type { Countertop, DesignDocument } from '../document/index.js';
import { documentArb } from '../test/arbitraries.js';
import { clone } from '../test/fixtures.js';
import { free, kitchen, on, WALL_IDS } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { type BomLine, computeBom, COUNTERTOP_CATALOG_ID, lineTotalCents } from './bom.js';
import { computeQuote, DEFAULT_QUOTE_SETTINGS } from './quote.js';

const [NORTH, EAST, SOUTH] = WALL_IDS;

const top = (
  wallId: string,
  start: number,
  end: number,
  overrides: Partial<Countertop> = {},
): Omit<Countertop, 'id'> => ({
  wallId,
  startOffset: inches(start),
  endOffset: inches(end),
  depth: inches(25.5),
  thickness: inches(1.5),
  elevation: inches(34.5),
  ...overrides,
});

const bom = (doc: DesignDocument, catalog: Catalog = SEED_CATALOG) => computeBom(doc, catalog);
const only = (lines: BomLine[]): BomLine => {
  expect(lines).toHaveLength(1);
  return lines[0]!;
};

describe('computeBom: items', () => {
  it('is empty for an empty design', () => {
    expect(bom(kitchen())).toEqual([]);
  });

  it('prices an item: base, plus per inch of width, plus options', () => {
    // 12000 + 30 in x 600 + 2500 for the top drawer, in the default white finish.
    const line = only(bom(kitchen([on('base.standard', NORTH, 0)])));

    expect(line).toEqual({
      key: expect.any(String) as string,
      catalogId: 'base.standard',
      description: 'Base cabinet, 2 doors, top drawer, hinge left',
      width: inches(30),
      height: inches(34.5),
      depth: inches(24),
      finishId: 'cabinet.white',
      options: { doors: 2, hinge: 'left', topDrawer: true },
      quantity: 1,
      unit: 'each',
      unitPriceCents: 32500,
      lineTotalCents: 32500,
      itemIds: ['item-0000'],
    });
  });

  it('groups identical items into one line with a quantity', () => {
    const doc = kitchen([
      on('base.standard', NORTH, 0),
      on('base.standard', NORTH, 30),
      free('base.standard', 60, 60),
    ]);

    const line = only(bom(doc));

    // Where an item is does not matter, only what it is.
    expect(line.quantity).toBe(3);
    expect(line.lineTotalCents).toBe(97500);
    expect(line.itemIds).toEqual(['item-0000', 'item-0001', 'item-0002']);
  });

  it('groups an item that spells out a default option with one that leaves it out', () => {
    const doc = kitchen([
      on('base.standard', NORTH, 0, { options: {} }),
      on('base.standard', NORTH, 30, { options: { topDrawer: true, hinge: 'left', doors: 2 } }),
    ]);

    expect(only(bom(doc)).quantity).toBe(2);
  });

  it('splits lines on a different option, size or finish', () => {
    const doc = kitchen([
      on('base.standard', NORTH, 0),
      on('base.standard', NORTH, 30, {
        options: { doors: 2, topDrawer: false, hinge: 'left' },
      }),
      on('base.standard', NORTH, 60, { width: inches(36) }),
      on('base.standard', EAST, 30, { finishId: 'cabinet.oak' }),
    ]);

    const lines = bom(doc);

    expect(lines.map((line) => [line.description, line.width, line.finishId, line.unitPriceCents]))
      // By width, then by key: the finish, then the options.
      .toEqual([
        ['Base cabinet, 2 doors, top drawer, hinge left', inches(30), 'cabinet.oak', 40625],
        ['Base cabinet, 2 doors, hinge left', inches(30), 'cabinet.white', 30000],
        ['Base cabinet, 2 doors, top drawer, hinge left', inches(30), 'cabinet.white', 32500],
        ['Base cabinet, 2 doors, top drawer, hinge left', inches(36), 'cabinet.white', 36100],
      ]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(4);
  });

  it('prices an option by its value', () => {
    // 18000 + 24 in x 800 = 37200, and 3000 more with four drawers.
    const doc = kitchen([
      on('base.drawers', NORTH, 0, { options: { drawers: 3 } }),
      on('base.drawers', NORTH, 30, { options: { drawers: 4 } }),
    ]);

    expect(bom(doc).map((line) => [line.description, line.unitPriceCents])).toEqual([
      ['Drawer base cabinet, 3 drawers', 37200],
      ['Drawer base cabinet, 4 drawers', 40200],
    ]);
  });

  it('takes the finish from the item, then the design, then the catalog', () => {
    const items = [on('base.standard', NORTH, 0)];
    const withDesignFinish = kitchen(items, {
      patch: (doc) => void (doc.finishes.cabinet = 'cabinet.navy'),
    });
    const withItemFinish = kitchen([on('base.standard', NORTH, 0, { finishId: 'cabinet.oak' })], {
      patch: (doc) => void (doc.finishes.cabinet = 'cabinet.navy'),
    });

    expect(only(bom(kitchen(items)))).toMatchObject({ finishId: 'cabinet.white' });
    // Navy is 110 percent: 32500 x 1.1.
    expect(only(bom(withDesignFinish))).toMatchObject({
      finishId: 'cabinet.navy',
      unitPriceCents: 35750,
    });
    expect(only(bom(withItemFinish))).toMatchObject({
      finishId: 'cabinet.oak',
      unitPriceCents: 40625,
    });
  });

  it('gives an appliance no finish', () => {
    const line = only(bom(kitchen([on('appliance.range', NORTH, 0)])));

    expect(line).toMatchObject({ finishId: null, unitPriceCents: 0, lineTotalCents: 0 });
  });

  it('prices without a multiplier when the finish is unknown or the catalog has none', () => {
    const unknown = kitchen([on('base.standard', NORTH, 0, { finishId: 'cabinet.gone' })]);
    const bare: Catalog = { ...SEED_CATALOG, finishes: [] };

    expect(only(bom(unknown))).toMatchObject({ finishId: 'cabinet.gone', unitPriceCents: 32500 });
    expect(only(bom(kitchen([on('base.standard', NORTH, 0)]), bare))).toMatchObject({
      finishId: null,
      unitPriceCents: 32500,
    });
  });

  it('still counts an item whose entry is not in the catalog, at no price', () => {
    const doc = kitchen([on('base.standard', NORTH, 0, { catalogId: 'base.discontinued' })]);

    expect(only(bom(doc))).toMatchObject({
      catalogId: 'base.discontinued',
      description: 'base.discontinued',
      unitPriceCents: 0,
      itemIds: ['item-0000'],
    });
  });

  it('describes one of something in the singular', () => {
    const doc = kitchen([on('base.standard', NORTH, 0, { options: { doors: 1 } })]);

    expect(only(bom(doc)).description).toBe('Base cabinet, 1 door, top drawer, hinge left');
  });
});

describe('computeBom: fillers', () => {
  /** The seed catalog with fillers priced by the inch, which the seed ones are not. */
  const byTheInch = (baseCents: number, perInchWidthCents: number): Catalog => ({
    ...SEED_CATALOG,
    entries: SEED_CATALOG.entries.map((entry) =>
      entry.id === 'filler.base' ? { ...entry, price: { baseCents, perInchWidthCents } } : entry,
    ),
  });
  const filler = (sixteenths: number, finishId?: string) =>
    kitchen([on('filler.base', NORTH, 0, { width: sixteenths, ...(finishId && { finishId }) })]);

  it('uses the fractional width', () => {
    // 1 5/16 in at 333 a inch is 437.0625, on a base of 2500.
    expect(only(bom(filler(21), byTheInch(2500, 333))).unitPriceCents).toBe(2937);
    // Times 1.1 for navy: 3230.76875.
    expect(only(bom(filler(21, 'cabinet.navy'), byTheInch(2500, 333))).unitPriceCents).toBe(3231);
  });

  it('rounds half a cent up, once, at the unit price', () => {
    // 1/16 in at 8 a inch is exactly half a cent.
    expect(only(bom(filler(1), byTheInch(100, 8))).unitPriceCents).toBe(101);
    // 7.99... would be under a half; 7 a inch gives 0.4375.
    expect(only(bom(filler(1), byTheInch(100, 7))).unitPriceCents).toBe(100);
    // Rounded once: 100.5 x 1.25 is 125.625, not 101 x 1.25.
    expect(only(bom(filler(1, 'cabinet.oak'), byTheInch(100, 8))).unitPriceCents).toBe(126);
  });

  it('keeps fillers of different widths on different lines', () => {
    const doc = kitchen([
      on('filler.base', NORTH, 0, { width: inches(1.5) }),
      on('filler.base', NORTH, 30, { width: inches(1.5) }),
      on('filler.base', NORTH, 60, { width: inches(2.25) }),
    ]);

    expect(bom(doc).map((line) => [line.width, line.quantity])).toEqual([
      [inches(1.5), 2],
      [inches(2.25), 1],
    ]);
  });
});

describe('computeBom: countertops', () => {
  it('prices by the square foot, in hundredths rounded up', () => {
    // 97.5 in x 25.5 in = 2486.25 sq in = 17.265625 sq ft, which is bought as 17.27.
    const line = only(bom(kitchen([], { countertops: [top(NORTH, 0, 97.5)] })));

    expect(line).toEqual({
      key: 'countertop|countertop.white',
      catalogId: COUNTERTOP_CATALOG_ID,
      description: 'Countertop, White stone',
      width: inches(97.5),
      height: inches(1.5),
      depth: inches(25.5),
      finishId: 'countertop.white',
      options: {},
      quantity: 1727,
      unit: 'sqft',
      unitPriceCents: 6500,
      lineTotalCents: 112255,
      itemIds: ['top-0000'],
    });
  });

  it('does not round an exact area up', () => {
    // 48 in x 24 in is 8 sq ft.
    const doc = kitchen([], { countertops: [top(NORTH, 0, 48, { depth: inches(24) })] });

    expect(only(bom(doc)).quantity).toBe(800);
  });

  it('adds the slabs of one finish up before rounding, on one line', () => {
    // 2486.25 + 765 sq in = 22.578125 sq ft: 22.58, not 17.27 + 5.32.
    const doc = kitchen([], {
      countertops: [
        top(NORTH, 0, 97.5),
        top(EAST, 0, 30, { depth: inches(25.5), thickness: inches(2) }),
      ],
    });

    expect(only(bom(doc))).toMatchObject({
      quantity: 2258,
      width: inches(127.5),
      height: inches(2),
      depth: inches(25.5),
      itemIds: ['top-0000', 'top-0001'],
    });
  });

  it('makes one line per finish, from the countertop, the design or the catalog', () => {
    const doc = kitchen([], {
      countertops: [
        top(NORTH, 0, 48, { depth: inches(24) }),
        top(EAST, 0, 48, { depth: inches(24), finishId: 'countertop.butcher' }),
        top(SOUTH, 0, 24, { depth: inches(30), finishId: 'countertop.butcher' }),
      ],
      patch: (raw) => void (raw.finishes.countertop = 'countertop.charcoal'),
    });

    expect(bom(doc).map((line) => [line.finishId, line.quantity, line.unitPriceCents])).toEqual([
      // 24 in + 48 in long, sorted before the 48 in one.
      ['countertop.charcoal', 800, 7500],
      ['countertop.butcher', 1300, 4500],
    ]);
  });

  it('counts a countertop of an unknown finish at no price', () => {
    const doc = kitchen([], { countertops: [top(NORTH, 0, 48, { finishId: 'countertop.gone' })] });
    const bare: Catalog = { ...SEED_CATALOG, finishes: [] };

    expect(only(bom(doc))).toMatchObject({
      description: 'Countertop',
      finishId: 'countertop.gone',
      unitPriceCents: 0,
      lineTotalCents: 0,
    });
    expect(only(bom(kitchen([], { countertops: [top(NORTH, 0, 48)] }), bare))).toMatchObject({
      key: 'countertop|',
      finishId: null,
    });
  });
});

describe('computeBom: order', () => {
  it('sorts by kind, then width, then catalog id', () => {
    const doc = kitchen(
      [
        on('panel.end', NORTH, 0),
        on('filler.base', NORTH, 3, { width: inches(3) }),
        on('appliance.range', NORTH, 6),
        on('base.corner.blind', EAST, 0),
        on('tall.pantry', EAST, 60),
        on('wall.standard', SOUTH, 0),
        on('base.sink', SOUTH, 40),
        on('base.standard', SOUTH, 80, { width: inches(36) }),
        on('base.drawers', NORTH, 60, { width: inches(36) }),
        on('base.standard', NORTH, 100, { width: inches(12) }),
      ],
      { countertops: [top(NORTH, 0, 48)] },
    );

    expect(bom(doc).map((line) => `${line.catalogId} ${line.width / 16}`)).toEqual([
      'base.standard 12',
      'base.drawers 36',
      'base.sink 36',
      'base.standard 36',
      'wall.standard 30',
      'tall.pantry 24',
      'base.corner.blind 36',
      'appliance.range 30',
      'filler.base 3',
      'panel.end 0.75',
      'countertop 48',
    ]);
  });

  it('does not depend on the order of the items', () => {
    const specs = [
      on('base.standard', NORTH, 0),
      on('wall.standard', NORTH, 0),
      on('base.sink', NORTH, 40),
    ];
    const strip = (lines: BomLine[]) => lines.map((line) => ({ ...line, itemIds: [] }));

    expect(strip(bom(kitchen([...specs].reverse())))).toEqual(strip(bom(kitchen(specs))));
  });
});

describe('lineTotalCents', () => {
  it('multiplies pieces, and rounds square feet half up', () => {
    expect(lineTotalCents(3, 'each', 32500)).toBe(97500);
    expect(lineTotalCents(1727, 'sqft', 6500)).toBe(112255);
    expect(lineTotalCents(1, 'sqft', 50)).toBe(1);
    expect(lineTotalCents(1, 'sqft', 49)).toBe(0);
  });
});

describe('computeBom: every document', () => {
  it('accounts for each item and countertop exactly once, in integer cents', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const lines = computeBom(doc, SEED_CATALOG);
        const counted = lines.flatMap((line) => line.itemIds).sort();
        const present = [...doc.items, ...doc.countertops].map((entity) => entity.id).sort();
        expect(counted).toEqual(present);

        for (const line of lines) {
          expect(Number.isSafeInteger(line.quantity)).toBe(true);
          expect(Number.isSafeInteger(line.unitPriceCents)).toBe(true);
          expect(Number.isSafeInteger(line.lineTotalCents)).toBe(true);
          expect(line.unitPriceCents).toBeGreaterThanOrEqual(0);
          expect(line.lineTotalCents).toBe(
            lineTotalCents(line.quantity, line.unit, line.unitPriceCents),
          );
          if (line.unit === 'each') expect(line.quantity).toBe(line.itemIds.length);
        }
        expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);

        const totals = computeQuote(lines, DEFAULT_QUOTE_SETTINGS);
        expect(totals.subtotalCents).toBe(lines.reduce((sum, l) => sum + l.lineTotalCents, 0));
        expect(totals.totalCents).toBe(totals.subtotalCents);
      }),
    );
  });

  it('gives the same lines for the same document', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        expect(computeBom(doc, SEED_CATALOG)).toEqual(computeBom(clone(doc), SEED_CATALOG));
      }),
    );
  });
});
