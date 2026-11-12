import {
  applyCommand,
  type Command,
  createEmptyDocument,
  defaultItemFor,
  type DesignDocument,
  getEntry,
  type Id,
  inches,
  type Item,
  SEED_CATALOG,
} from '@ezd/core';

import type { NewId } from '../editor/ids';
import { roomCommand } from '../editor/tools/wall';
import { createDesignStore, type DesignStoreApi } from '../store/designStore';

// Small kitchens for the web tests. Sizes and positions are in inches here.

/** Ids that count up, so tests can name what they made: `wall-000000`, `wall-000001`. */
export function countingIds(): NewId {
  const next = new Map<string, number>();
  return (prefix) => {
    const n = next.get(prefix) ?? 0;
    next.set(prefix, n + 1);
    return `${prefix}-${String(n).padStart(6, '0')}`;
  };
}

/** The four walls of `room`, clockwise from the top: A, B, C and D. */
export const WALLS = ['wall-000000', 'wall-000001', 'wall-000002', 'wall-000003'] as const;

export function apply(doc: DesignDocument, ...commands: Command[]): DesignDocument {
  return commands.reduce((current, command) => {
    const applied = applyCommand(current, command, { catalog: SEED_CATALOG });
    if (!applied.ok) throw new Error(applied.error.message);
    return applied.value.doc;
  }, doc);
}

/** A seed item at its default size on a wall, `offset` inches from the wall start. */
export function seedItem(
  id: Id,
  catalogId: string,
  wallId: Id,
  offset: number,
  overrides: Partial<Item> = {},
): Item {
  const entry = getEntry(SEED_CATALOG, catalogId);
  if (!entry) throw new Error(`no seed entry ${catalogId}`);
  return {
    ...defaultItemFor(entry, id, { type: 'wall', wallId, offset: inches(offset) }),
    ...overrides,
  };
}

/** An empty rectangular room, 144 by 120 in unless given, with walls `WALLS`. */
export function room(width = 144, depth = 120, ...items: Item[]): DesignDocument {
  const empty = createEmptyDocument({ id: 'design-test01', name: 'Test kitchen' });
  const walls = roomCommand(
    'rectangle',
    { width: inches(width), depth: inches(depth), notchWidth: 0, notchDepth: 0 },
    countingIds(),
  );
  if (!walls.ok) throw new Error(walls.error);
  return apply(empty, walls.value, ...items.map((item): Command => ({ type: 'item.add', item })));
}

export const storeFor = (doc: DesignDocument): DesignStoreApi => createDesignStore(doc);
