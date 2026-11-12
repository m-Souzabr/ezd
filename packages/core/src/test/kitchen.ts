import { defaultItemFor, getEntry, SEED_CATALOG } from '../catalog/index.js';
import {
  type Countertop,
  type DesignDocument,
  type Id,
  type Item,
  type Opening,
  parseDocument,
  type Swing,
} from '../document/index.js';
import { inches } from '../units/index.js';
import { deepFreeze } from './fixtures.js';

// Builds small kitchens from the seed catalog for the rules and snapping tests. Sizes and
// positions are in inches here, and nowhere else.

export type ItemSpec = (id: Id) => Item;
export type OpeningSpec = (id: Id) => Opening;

const entry = (catalogId: string) => {
  const found = getEntry(SEED_CATALOG, catalogId);
  if (!found) throw new Error(`no seed entry ${catalogId}`);
  return found;
};

/** A seed item at its default size on a wall, `offset` inches from the wall start. */
export const on =
  (catalogId: string, wallId: Id, offset: number, overrides: Partial<Item> = {}): ItemSpec =>
  (id) => ({
    ...defaultItemFor(entry(catalogId), id, { type: 'wall', wallId, offset: inches(offset) }),
    ...overrides,
  });

/** A free-standing seed item with its back left corner at (x, y) inches. */
export const free =
  (
    catalogId: string,
    x: number,
    y: number,
    rotation = 0,
    overrides: Partial<Item> = {},
  ): ItemSpec =>
  (id) => ({
    ...defaultItemFor(entry(catalogId), id, {
      type: 'free',
      x: inches(x),
      y: inches(y),
      rotation,
    }),
    ...overrides,
  });

/** An 80 in high door. */
export const door =
  (wallId: Id, offset: number, width: number, swing?: Swing): OpeningSpec =>
  (id) => ({
    id,
    wallId,
    kind: 'door',
    offset: inches(offset),
    width: inches(width),
    height: inches(80),
    sillHeight: 0,
    ...(swing && { swing }),
  });

export const passage =
  (wallId: Id, offset: number, width: number): OpeningSpec =>
  (id) => ({
    id,
    wallId,
    kind: 'passage',
    offset: inches(offset),
    width: inches(width),
    height: inches(80),
    sillHeight: 0,
  });

export const windowAt =
  (wallId: Id, offset: number, width: number, sill = 36, height = 36): OpeningSpec =>
  (id) => ({
    id,
    wallId,
    kind: 'window',
    offset: inches(offset),
    width: inches(width),
    height: inches(height),
    sillHeight: inches(sill),
  });

export type KitchenOptions = {
  /** Length of the north and south walls. 144 by default. */
  width?: number;
  /** Length of the east and west walls. 120 by default. */
  depth?: number;
  /** How many of the four walls to build, clockwise from the north wall. */
  walls?: number;
  openings?: OpeningSpec[];
  countertops?: Omit<Countertop, 'id'>[];
  /** Changes the raw document before it is parsed. */
  patch?: (doc: DesignDocument) => void;
};

export const WALL_IDS = ['wall-north', 'wall-east', 'wall-south', 'wall-west'] as const;

/**
 * A room with a 96 in ceiling whose walls run clockwise from the north wall: A is
 * `wall-north`, B `wall-east`, C `wall-south` and D `wall-west`. Items get the ids
 * `item-0000`, `item-0001` and so on, openings `opening-00` and countertops `top-0000`.
 * Frozen, so any mutation throws.
 */
export function kitchen(specs: ItemSpec[] = [], options: KitchenOptions = {}): DesignDocument {
  const width = inches(options.width ?? 144);
  const depth = inches(options.depth ?? 120);
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
  const doc: DesignDocument = {
    schemaVersion: 1,
    id: 'doc-00000001',
    name: 'Test kitchen',
    room: {
      ceilingHeight: inches(96),
      walls: WALL_IDS.slice(0, options.walls ?? 4).map((id, i) => ({
        id,
        start: corners[i]!,
        end: corners[(i + 1) % 4]!,
        thickness: inches(4.5),
      })),
      openings: (options.openings ?? []).map((spec, i) =>
        spec(`opening-${String(i).padStart(2, '0')}`),
      ),
    },
    items: specs.map((spec, i) => spec(`item-${String(i).padStart(4, '0')}`)),
    countertops: (options.countertops ?? []).map((top, i) => ({
      id: `top-${String(i).padStart(4, '0')}`,
      ...top,
    })),
    finishes: {},
  };
  options.patch?.(doc);
  const parsed = parseDocument(doc);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return deepFreeze(parsed.value);
}
