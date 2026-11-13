import { describe, expect, it } from 'vitest';

import {
  activeEntries,
  type Catalog,
  type CatalogEntry,
  CatalogSchema,
  defaultItemFor,
  firstAvailable,
  getEntry,
  SEED_CATALOG,
  seedCatalogProvider,
} from '../catalog/index.js';
import { applyCommand } from '../commands/index.js';
import { catalogIndexForLLM, llmToolDefinitions, proposalToCommands } from '../llm/index.js';
import { kitchen, on } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { jsonCatalogProvider } from './provider.js';
import { OPTION_KINDS, parseCatalog, REQUIRED_CATALOG_IDS, validateCatalog } from './validate.js';

const clone = (): Catalog => JSON.parse(JSON.stringify(SEED_CATALOG)) as Catalog;

/** The seed with one entry changed. */
function withEntry(id: string, change: (entry: CatalogEntry) => void): Catalog {
  const catalog = clone();
  change(getEntry(catalog, id)!);
  return catalog;
}

const paths = (catalog: Catalog): string[] => validateCatalog(catalog).map((p) => p.path);
const messages = (catalog: Catalog): string =>
  validateCatalog(catalog)
    .map((p) => p.message)
    .join('\n');

describe('validateCatalog', () => {
  it('accepts the seed catalog and its JSON round trip', () => {
    expect(validateCatalog(SEED_CATALOG)).toEqual([]);
    expect(CatalogSchema.safeParse(JSON.parse(JSON.stringify(SEED_CATALOG))).success).toBe(true);
    expect(parseCatalog(JSON.parse(JSON.stringify(SEED_CATALOG)))).toEqual({
      ok: true,
      value: SEED_CATALOG,
    });
  });

  it('reports a schema failure with its path', () => {
    const result = parseCatalog({ version: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((p) => p.path)).toContain('version');
  });

  it('reports every problem, not the first', () => {
    const catalog = clone();
    catalog.entries[0]!.price.baseCents = -1;
    catalog.finishes[0]!.color = 'white';
    const result = parseCatalog(catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveLength(2);
  });

  it('needs a version, entry names and ids, and unique ids', () => {
    const catalog = clone();
    catalog.version = ' ';
    catalog.entries[0]!.name = '';
    catalog.entries[1]!.id = catalog.entries[2]!.id;
    catalog.finishes[1]!.id = catalog.finishes[0]!.id;
    catalog.finishes[2]!.name = '';
    const found = validateCatalog(catalog);
    expect(found.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        'version',
        'entries.0.name',
        'entries',
        'finishes',
        'finishes.2.name',
      ]),
    );
    expect(found.some((p) => /used twice/.test(p.message))).toBe(true);
  });

  it('keeps the default size inside the allowed lists', () => {
    const catalog = withEntry('base.standard', (entry) => {
      entry.defaultSize = { width: inches(31), height: inches(40), depth: inches(20) };
    });
    expect(paths(catalog)).toEqual(
      expect.arrayContaining([
        'entries.0.defaultSize.width',
        'entries.0.defaultSize.height',
        'entries.0.defaultSize.depth',
      ]),
    );
    const stepped = withEntry('base.standard', (entry) => {
      entry.defaultSize.width = inches(51);
    });
    expect(paths(stepped)).toContain('entries.0.defaultSize.width');
    const listed = withEntry('appliance.fridge', (entry) => {
      entry.defaultSize.width = inches(31);
    });
    expect(validateCatalog(listed).some((p) => p.path.endsWith('defaultSize.width'))).toBe(true);
    const filler = withEntry('filler.base', (entry) => {
      entry.defaultSize.width = inches(7);
    });
    expect(validateCatalog(filler).some((p) => p.path.endsWith('defaultSize.width'))).toBe(true);
    const odd = withEntry('base.standard', (entry) => {
      entry.defaultElevation = -1;
    });
    expect(paths(odd)).toContain('entries.0.defaultElevation');
  });

  it('keeps widths on the 3 in grid, except fillers', () => {
    const step = withEntry('base.standard', (entry) => {
      entry.width = { min: inches(9), max: inches(48), step: inches(2) };
    });
    expect(paths(step)).toContain('entries.0.width.step');
    const min = withEntry('base.standard', (entry) => {
      entry.width = { min: inches(10), max: inches(46), step: inches(3) };
    });
    expect(paths(min)).toEqual(
      expect.arrayContaining(['entries.0.width.min', 'entries.0.width.max']),
    );
    const order = withEntry('base.standard', (entry) => {
      entry.width = { min: inches(48), max: inches(9), step: inches(3) };
    });
    expect(messages(order)).toMatch(/less than the least/);
    const gap = withEntry('base.standard', (entry) => {
      entry.width = { min: inches(9), max: inches(48), step: inches(6) };
    });
    expect(messages(gap)).toMatch(/whole number of steps/);
    const values = withEntry('appliance.fridge', (entry) => {
      entry.width = { values: [inches(30), inches(31)] };
    });
    expect(paths(values)).toContain(
      'entries.' +
        SEED_CATALOG.entries.findIndex((e) => e.id === 'appliance.fridge') +
        '.width.values.1',
    );
    const empty = withEntry('appliance.fridge', (entry) => {
      entry.width = { values: [] };
    });
    expect(messages(empty)).toMatch(/at least one width/);
    const twice = withEntry('appliance.fridge', (entry) => {
      entry.width = { values: [inches(30), inches(30)] };
      entry.defaultSize.width = inches(30);
    });
    expect(messages(twice)).toMatch(/unique/);
  });

  it('lets only fillers come at any width, within a sane range', () => {
    const base = withEntry('base.standard', (entry) => {
      entry.width = { free: { min: inches(1), max: inches(6) } };
    });
    expect(messages(base)).toMatch(/Only fillers/);
    const filler = withEntry('filler.base', (entry) => {
      entry.width = { free: { min: inches(6), max: inches(1) } };
    });
    expect(paths(filler)).toContain(
      'entries.' + SEED_CATALOG.entries.findIndex((e) => e.id === 'filler.base') + '.width.free',
    );
  });

  it('needs sizes: at least one, positive, unique', () => {
    const none = withEntry('base.standard', (entry) => {
      entry.heights = [];
      entry.depths = [0, 0];
    });
    expect(messages(none)).toMatch(/at least one size/);
    expect(messages(none)).toMatch(/greater than zero/);
    expect(messages(none)).toMatch(/unique/);
  });

  it('gives L and diagonal corners equal width and depth', () => {
    const deep = withEntry('base.corner.susan', (entry) => {
      entry.defaultSize.depth = inches(30);
      entry.depths = [inches(30), ...entry.depths];
    });
    expect(messages(deep)).toMatch(/as deep as it is wide/);
    const blind = withEntry('base.corner.blind', (entry) => {
      entry.corner = 'blind';
    });
    expect(validateCatalog(blind)).toEqual([]);
    const stray = withEntry('base.standard', (entry) => {
      entry.corner = 'l';
    });
    expect(messages(stray)).toMatch(/Only corner entries/);
  });

  it('needs a width in the depths for each width of an L corner', () => {
    const catalog = withEntry('base.corner.susan', (entry) => {
      entry.width = { values: [inches(36), inches(42)] };
      entry.depths = [inches(36)];
      entry.defaultSize = { ...entry.defaultSize, width: inches(36), depth: inches(36) };
    });
    expect(messages(catalog)).toMatch(/needs the same depth/);
    const stepped = withEntry('base.corner.susan', (entry) => {
      entry.width = { min: inches(33), max: inches(39), step: inches(3) };
      entry.depths = [inches(36)];
      entry.defaultSize = { ...entry.defaultSize, width: inches(36), depth: inches(36) };
    });
    expect(messages(stepped)).toMatch(/needs the same depth/);
  });

  it('checks options: keys, values, defaults and the kinds that use them', () => {
    const odd = withEntry('base.standard', (entry) => {
      entry.options = [
        { key: 'doors', type: 'int', values: [1, 2], default: 3 },
        { key: 'doors', type: 'int', values: [], default: 1 },
        { key: '', type: 'enum', values: [], default: 'x' },
        { key: 'r', type: 'int', range: { min: 5, max: 1 }, default: 3 },
        { key: 'ovens', type: 'int', values: [1], default: 1 },
        { key: 'e', type: 'enum', values: ['a'], default: 'b' },
        { key: 'b', type: 'bool', default: true },
      ];
    });
    const found = messages(odd);
    expect(found).toMatch(/appears twice/);
    expect(found).toMatch(/default 3 is not one of the values/);
    expect(found).toMatch(/at least one value/);
    expect(found).toMatch(/needs a key/);
    expect(found).toMatch(/greatest value is less/);
    expect(found).toMatch(/only works on tall/);
    expect(found).toMatch(/default b is not/);
    const kinds = Object.keys(OPTION_KINDS);
    for (const entry of SEED_CATALOG.entries) {
      for (const def of entry.options) {
        if (kinds.includes(def.key)) expect(OPTION_KINDS[def.key]).toContain(entry.kind);
      }
    }
  });

  it('checks prices: cents are non-negative integers and option keys are real', () => {
    const catalog = withEntry('base.standard', (entry) => {
      entry.price = {
        baseCents: -5,
        perInchWidthCents: 1.5,
        optionCents: {
          'topDrawer=true': 100,
          'topDrawer=maybe': 100,
          'nothing=1': 100,
          noequals: 100,
          'doors=2': -1,
        },
      };
    });
    const found = validateCatalog(catalog);
    expect(found.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        'entries.0.price.baseCents',
        'entries.0.price.perInchWidthCents',
        'entries.0.price.optionCents.topDrawer=maybe',
        'entries.0.price.optionCents.nothing=1',
        'entries.0.price.optionCents.noequals',
        'entries.0.price.optionCents.doors=2',
      ]),
    );
    expect(found.map((p) => p.path)).not.toContain('entries.0.price.optionCents.topDrawer=true');
  });

  it('checks placements and finishes', () => {
    const placement = withEntry('base.standard', (entry) => {
      entry.placement = ['wall', 'wall'];
    });
    expect(messages(placement)).toMatch(/unique/);
    const none = withEntry('base.standard', (entry) => {
      entry.placement = [];
    });
    expect(messages(none)).toMatch(/at least one placement/);

    const catalog = clone();
    catalog.finishes[0]!.color = '#12345';
    catalog.finishes[1]!.multiplierBps = 0;
    catalog.finishes[4]!.pricePerSqftCents = -1;
    catalog.finishes[5]!.id = ' ';
    expect(paths(catalog)).toEqual(
      expect.arrayContaining([
        'finishes.0.color',
        'finishes.1.multiplierBps',
        'finishes.4.pricePerSqftCents',
        'finishes.5.id',
      ]),
    );
    const upper = clone();
    upper.finishes[0]!.color = '#ABCDEF';
    expect(validateCatalog(upper)).toEqual([]);
  });

  it('requires the entries that code looks up by id, and not retired', () => {
    expect(REQUIRED_CATALOG_IDS).toEqual(
      expect.arrayContaining([
        'appliance.range',
        'appliance.hood',
        'appliance.fridge',
        'appliance.dishwasher',
        'base.sink',
        'base.standard',
        'wall.standard',
        'tall.pantry',
        'appliance.microwave',
      ]),
    );
    for (const id of REQUIRED_CATALOG_IDS) {
      const gone = clone();
      gone.entries = gone.entries.filter((entry) => entry.id !== id);
      expect(messages(gone)).toContain(`"${id}" is required by the app and is missing`);
      const retired = withEntry(id, (entry) => {
        entry.retired = true;
      });
      expect(messages(retired)).toContain(`"${id}" is required by the app and cannot be retired`);
    }
    const spare = withEntry('base.drawers', (entry) => {
      entry.retired = true;
    });
    expect(validateCatalog(spare)).toEqual([]);
  });
});

describe('retired entries', () => {
  const retired = withEntry('base.drawers', (entry) => {
    entry.retired = true;
  });
  const doc = kitchen([on('base.drawers', 'wall-north', 0)]);
  const drawers = getEntry(retired, 'base.drawers')!;
  const added = defaultItemFor(drawers, 'item-new-01', {
    type: 'wall',
    wallId: 'wall-north',
    offset: inches(60),
  });

  it('cannot be added, and the error names what to use', () => {
    const result = applyCommand(doc, { type: 'item.add', item: added }, { catalog: retired });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGUMENT');
      expect(result.error.constraintErrors?.[0]?.code).toBe('ENTRY_RETIRED');
      expect(result.error.message).toContain('retired');
    }
    expect(applyCommand(doc, { type: 'item.add', item: added }, { catalog: SEED_CATALOG }).ok).toBe(
      true,
    );
  });

  it('keep working in a document that already has one', () => {
    const [existing] = doc.items;
    expect(
      applyCommand(
        doc,
        { type: 'item.setOptions', id: existing!.id, options: { drawers: 4 } },
        { catalog: retired },
      ).ok,
    ).toBe(true);
  });

  it('are left out of the assistant tools and index, and refused when proposed', () => {
    expect(activeEntries(retired).some((entry) => entry.id === 'base.drawers')).toBe(false);
    expect(catalogIndexForLLM(retired)).not.toContain('base.drawers');
    expect(catalogIndexForLLM(SEED_CATALOG)).toContain('base.drawers');
    expect(JSON.stringify(llmToolDefinitions(retired))).not.toContain('base.drawers');
    const result = proposalToCommands(
      [
        {
          name: 'add_item',
          arguments: { catalogId: 'base.drawers', widthIn: 24, wall: 'A', offsetIn: 120 },
        },
      ],
      {},
      doc,
      retired,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toMatch(/retired/);
  });
});

describe('jsonCatalogProvider', () => {
  it('loads a valid catalog, and says why an invalid one failed', async () => {
    const valid = jsonCatalogProvider('remote', () =>
      Promise.resolve(JSON.parse(JSON.stringify(SEED_CATALOG))),
    );
    expect(await valid.load()).toEqual({ ok: true, value: SEED_CATALOG });

    const broken = clone();
    broken.entries[0]!.price.baseCents = -1;
    broken.entries[1]!.price.baseCents = -1;
    const loaded = await jsonCatalogProvider('remote', () => broken).load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toMatch(/entries\.0\.price\.baseCents.*and 1 more/);

    const thrown = await jsonCatalogProvider('remote', () => {
      throw new Error('offline');
    }).load();
    expect(thrown).toEqual({ ok: false, error: 'offline' });
    const odd = await jsonCatalogProvider('remote', () => {
      throw 'nope';
    }).load();
    expect(odd.ok).toBe(false);
    const single = clone();
    single.entries[0]!.price.baseCents = -1;
    const one = await jsonCatalogProvider('remote', () => single).load();
    expect(one.ok === false && /and \d+ more/.test(one.error)).toBe(false);
  });

  it('falls back to the seed through firstAvailable', async () => {
    const chain = firstAvailable([
      jsonCatalogProvider('remote', () => ({ nonsense: true })),
      seedCatalogProvider,
    ]);
    expect(await chain.load()).toEqual({ ok: true, value: SEED_CATALOG });
  });
});
