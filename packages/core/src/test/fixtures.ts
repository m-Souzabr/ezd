import { type DesignDocument, parseDocument } from '../document/index.js';
import danglingWallId from '../document/fixtures/dangling-wall-id.json' with { type: 'json' };
import duplicateId from '../document/fixtures/duplicate-id.json' with { type: 'json' };
import floatLength from '../document/fixtures/float-length.json' with { type: 'json' };
import valid from '../document/fixtures/valid.json' with { type: 'json' };
import zeroLengthWall from '../document/fixtures/zero-length-wall.json' with { type: 'json' };

export const fixtures = { valid, danglingWallId, duplicateId, floatLength, zeroLengthWall };

/** A plain, unfrozen copy, as it would come back from JSON. */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * A frozen 120 in by 96 in room, walls clockwise from the north wall, with a door, a
 * window, three items on walls and an island. Frozen so any mutation throws.
 */
export function sampleDocument(): DesignDocument {
  const parsed = parseDocument(clone(valid));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return deepFreeze(parsed.value);
}
