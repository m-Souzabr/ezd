import { describe, expect, it } from 'vitest';

import type { Item, OptionValue } from '../document/index.js';
import { clone } from '../test/fixtures.js';
import { EPS } from '../geometry/index.js';
import { inches } from '../units/index.js';
import {
  allowedOptionValues,
  allowedWidths,
  type Catalog,
  type CatalogEntry,
  checkItemAgainstCatalog,
  defaultItemFor,
  FRONT_REVEAL,
  generateParts,
  getEntry,
  MAX_SHELF_SPACING,
  type Part,
  PANEL_THICKNESS,
  SEED_CATALOG,
  TOE_KICK_DEPTH,
  TOE_KICK_HEIGHT,
} from './index.js';

const entries = SEED_CATALOG.entries;
const entryOf = (id: string): CatalogEntry => getEntry(SEED_CATALOG, id)!;
const onWall = { type: 'wall', wallId: 'wall-north', offset: 0 } as const;
const itemOf = (id: string, overrides: Partial<Item> = {}): Item => ({
  ...defaultItemFor(entryOf(id), 'item-000001', onWall),
  ...overrides,
});
const partsOf = (id: string, overrides: Partial<Item> = {}): Part[] =>
  generateParts(itemOf(id, overrides), SEED_CATALOG);
const withRole = (parts: Part[], role: Part['role']): Part[] =>
  parts.filter((part) => part.role === role);

/** Every combination of the entry's option values. */
function optionSets(entry: CatalogEntry): Item['options'][] {
  let sets: Record<string, OptionValue>[] = [{}];
  for (const def of entry.options) {
    sets = sets.flatMap((set) =>
      allowedOptionValues(def).map((value) => ({ ...set, [def.key]: value })),
    );
  }
  return sets;
}

/** Every item of the entry that its constraints allow. */
function* allItems(entry: CatalogEntry): Generator<Item> {
  for (const width of allowedWidths(entry)) {
    for (const height of entry.heights) {
      for (const depth of entry.depths) {
        for (const options of optionSets(entry)) {
          const item = itemOf(entry.id, { width, height, depth, options });
          if (checkItemAgainstCatalog(item, SEED_CATALOG).length === 0) yield item;
        }
      }
    }
  }
}

/** The four corners of the part in plan, as [x, z]. */
function planCorners({ box, rotation = 0 }: Part): [number, number][] {
  const angle = (rotation * Math.PI) / 180;
  const along = [Math.cos(angle), Math.sin(angle)] as const;
  const into = [-along[1], along[0]] as const;
  return [
    [0, 0],
    [box.w, 0],
    [box.w, box.d],
    [0, box.d],
  ].map(([w, d]) => [box.x + along[0] * w! + into[0] * d!, box.z + along[1] * w! + into[1] * d!]);
}

const isFront = (part: Part): boolean => part.role === 'door' || part.role === 'drawer-front';

describe('generateParts', () => {
  it.each(entries)('matches the snapshot for the default $id', (entry) => {
    expect(generateParts(itemOf(entry.id), SEED_CATALOG)).toMatchSnapshot();
  });

  it.each(entries)('keeps every box of every allowed $id inside the item', (entry) => {
    let checked = 0;
    for (const item of allItems(entry)) {
      const parts = generateParts(item, SEED_CATALOG);
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        const { box } = part;
        const values = Object.values(box);
        const ok =
          values.every(Number.isSafeInteger) &&
          box.w > 0 &&
          box.h > 0 &&
          box.d > 0 &&
          box.y >= 0 &&
          box.y + box.h <= item.height &&
          planCorners(part).every(
            ([x, z]) =>
              x >= -EPS &&
              x <= item.width + EPS &&
              z >= -EPS &&
              // Only fronts may project, by their own thickness.
              z <= item.depth + (isFront(part) ? PANEL_THICKNESS : 0) + EPS,
          );
        if (!ok) throw new Error(`${JSON.stringify(part)} leaves ${JSON.stringify(item)}`);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it.each(entries)('is deterministic for $id, and does not touch its input', (entry) => {
    const item = Object.freeze(itemOf(entry.id));
    const first = generateParts(item, SEED_CATALOG);
    expect(generateParts(item, SEED_CATALOG)).toEqual(first);
    expect(generateParts(clone(item), clone(SEED_CATALOG))).toEqual(first);
    // Position in the room and identity do not matter.
    const moved = { ...item, id: 'item-000002', placement: { ...onWall, offset: inches(40) } };
    expect(generateParts(moved, SEED_CATALOG)).toEqual(first);
  });

  it('returns nothing for an item that is not in the catalog', () => {
    expect(partsOf('base.standard', { catalogId: 'base.custom' })).toEqual([]);
  });

  describe('base cabinets', () => {
    it('have two sides, a bottom, a back and a toe kick recessed 3 in', () => {
      const parts = partsOf('base.standard');
      const roles = parts.filter((part) => part.finishSlot === 'carcass').map((part) => part.role);
      expect(roles).toEqual(['side', 'side', 'bottom', 'back', 'toe-kick']);
      const [toeKick] = withRole(parts, 'toe-kick');
      expect(toeKick!.box).toMatchObject({ y: 0, h: TOE_KICK_HEIGHT });
      expect(toeKick!.box.z + toeKick!.box.d).toBe(inches(24) - TOE_KICK_DEPTH);
    });

    it('build fronts from the options, 1/8 in apart', () => {
      const parts = partsOf('base.standard', { options: { doors: 2, topDrawer: true } });
      const doors = withRole(parts, 'door');
      const [drawer] = withRole(parts, 'drawer-front');
      expect(doors).toHaveLength(2);
      expect(doors[1]!.box.x - (doors[0]!.box.x + doors[0]!.box.w)).toBe(FRONT_REVEAL);
      expect(drawer!.box.y - (doors[0]!.box.y + doors[0]!.box.h)).toBe(FRONT_REVEAL);
      for (const part of [...doors, drawer!]) {
        expect(part.finishSlot).toBe('front');
        expect(part.box).toMatchObject({ z: inches(24), d: PANEL_THICKNESS });
      }

      const plain = partsOf('base.standard', { options: { doors: 1, topDrawer: false } });
      expect(withRole(plain, 'door')).toHaveLength(1);
      expect(withRole(plain, 'drawer-front')).toHaveLength(0);
    });

    it('stack 3 or 4 drawer fronts with a reveal between them', () => {
      for (const drawers of [3, 4]) {
        const fronts = withRole(partsOf('base.drawers', { options: { drawers } }), 'drawer-front');
        expect(fronts).toHaveLength(drawers);
        fronts.slice(1).forEach((front, i) => {
          expect(front.box.y - (fronts[i]!.box.y + fronts[i]!.box.h)).toBe(FRONT_REVEAL);
        });
      }
      expect(withRole(partsOf('base.drawers'), 'door')).toHaveLength(0);
    });

    it('fall back to the default for a missing or invalid option', () => {
      const defaults = partsOf('base.standard');
      expect(partsOf('base.standard', { options: {} })).toEqual(defaults);
      expect(partsOf('base.standard', { options: { doors: 7, topDrawer: 'yes' } })).toEqual(
        defaults,
      );
    });
  });

  describe('wall and tall cabinets', () => {
    it('have sides, a top, a bottom, a back and doors, and no toe kick on the wall', () => {
      const parts = partsOf('wall.standard', { height: inches(12) });
      expect(parts.map((part) => part.role)).toEqual([
        'side',
        'side',
        'bottom',
        'back',
        'top',
        'door',
        'door',
      ]);
      expect(withRole(partsOf('tall.pantry'), 'toe-kick')).toHaveLength(1);
    });

    it.each(['wall.standard', 'tall.pantry'])(
      'space the shelves of %s at most 15 in apart',
      (id) => {
        for (const height of entryOf(id).heights) {
          const parts = partsOf(id, { height });
          const levels = [
            ...withRole(parts, 'bottom'),
            ...withRole(parts, 'shelf'),
            ...withRole(parts, 'top'),
          ].map((part) => part.box.y);
          levels.slice(1).forEach((y, i) => {
            expect(y - levels[i]!).toBeGreaterThan(0);
            expect(y - levels[i]!).toBeLessThanOrEqual(MAX_SHELF_SPACING);
          });
        }
        expect(withRole(partsOf('wall.standard', { height: inches(42) }), 'shelf')).toHaveLength(2);
      },
    );

    it('give a pantry 2 doors, or 4 in two rows', () => {
      expect(withRole(partsOf('tall.pantry', { options: { doors: 2 } }), 'door')).toHaveLength(2);
      const four = withRole(partsOf('tall.pantry', { options: { doors: 4 } }), 'door');
      expect(four).toHaveLength(4);
      expect(new Set(four.map((door) => door.box.y)).size).toBe(2);
    });

    it('give an oven cabinet one appliance body per oven, a drawer below and doors above', () => {
      for (const ovens of [1, 2]) {
        const parts = partsOf('tall.oven', { options: { ovens } });
        const bodies = withRole(parts, 'body');
        expect(bodies).toHaveLength(ovens);
        expect(bodies.every((body) => body.finishSlot === 'appliance')).toBe(true);
        expect(withRole(parts, 'drawer-front')).toHaveLength(1);
        expect(withRole(parts, 'door')).toHaveLength(2);
        expect(withRole(parts, 'shelf')).toHaveLength(0);
      }
    });
  });

  describe('corner cabinets', () => {
    it('leave the blind end of a blind corner without a door', () => {
      const left = withRole(partsOf('base.corner.blind', { options: { blind: 'left' } }), 'door');
      const right = withRole(partsOf('base.corner.blind', { options: { blind: 'right' } }), 'door');
      expect(left).toHaveLength(1);
      expect(left[0]!.box.x).toBeGreaterThan(inches(24));
      expect(right[0]!.box.x + right[0]!.box.w).toBeLessThan(inches(12));
    });

    it('build a Lazy Susan as an L of square boxes with a door on each leg', () => {
      const parts = partsOf('base.corner.susan');
      expect(parts.every((part) => part.rotation === undefined)).toBe(true);
      const [along, across] = withRole(parts, 'door');
      // One door faces the room from the leg on its own wall, the other from the leg on
      // the adjacent wall.
      expect(along!.box.d).toBe(PANEL_THICKNESS);
      expect(across!.box.w).toBe(PANEL_THICKNESS);
      // Nothing fills the notch in front of the two legs.
      for (const { box } of parts) {
        const inNotch =
          box.x >= inches(24) + PANEL_THICKNESS && box.z >= inches(24) + PANEL_THICKNESS;
        expect(inNotch).toBe(false);
      }
    });

    it('put one door at 45 degrees across a diagonal corner', () => {
      const parts = partsOf('wall.corner.diagonal');
      const [door, ...others] = withRole(parts, 'door');
      expect(others).toEqual([]);
      expect(door!.rotation).toBe(135);
      const rotated = parts.filter((part) => part.rotation !== undefined);
      expect(new Set(rotated.map((part) => part.role))).toEqual(
        new Set(['bottom', 'top', 'shelf', 'door']),
      );
    });

    it('treat a corner entry with no shape as a blind corner', () => {
      const blind = { ...entryOf('base.corner.blind') };
      delete blind.corner;
      const catalog: Catalog = { ...SEED_CATALOG, entries: [blind] };
      expect(generateParts(itemOf('base.corner.blind'), catalog)).toEqual(
        partsOf('base.corner.blind'),
      );
    });
  });

  it.each([
    ['appliance.range', 'body', 'appliance'],
    ['filler.tall', 'filler', 'front'],
    ['panel.end', 'panel', 'front'],
  ] as const)('makes %s a single %s box the size of the item', (id, role, finishSlot) => {
    const item = itemOf(id);
    expect(generateParts(item, SEED_CATALOG)).toEqual([
      { role, finishSlot, box: { x: 0, y: 0, z: 0, w: item.width, h: item.height, d: item.depth } },
    ]);
  });

  it('uses fallbacks for an entry that defines no door or drawer options', () => {
    const bare = (id: string): Catalog => ({
      ...SEED_CATALOG,
      entries: [{ ...entryOf(id), options: [] }],
    });
    const doors = (id: string) =>
      withRole(generateParts(itemOf(id, { options: {} }), bare(id)), 'door').length;
    expect(doors('base.standard')).toBe(1);
    expect(doors('wall.standard')).toBe(1);
    expect(doors('tall.pantry')).toBe(2);
    expect(doors('base.corner.blind')).toBe(1);
  });
});
