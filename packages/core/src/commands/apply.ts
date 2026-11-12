import { checkItemAgainstCatalog, type ConstraintError } from '../catalog/constraints.js';
import type { Catalog } from '../catalog/types.js';
import {
  type Countertop,
  countertopProblem,
  type DesignDocument,
  type Id,
  isZeroLength,
  type Item,
  type Opening,
  openingProblem,
  toIssues,
  type Wall,
} from '../document/index.js';
import { describeIssues } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { type Command, type CommandOf, CommandSchema } from './schema.js';

export type CommandError = {
  code: 'SCHEMA' | 'NOT_FOUND' | 'DUPLICATE_ID' | 'INVALID_ARGUMENT' | 'WALL_HAS_ITEMS';
  message: string;
  /** Which command of a `batch` failed. */
  commandIndex?: number;
  /** Set when the item breaks the catalog's rules. Each lists the allowed values. */
  constraintErrors?: ConstraintError[];
};

/** What a command is checked against, beyond the document itself. */
export type CommandContext = {
  /**
   * When given, `item.add`, `item.resize` and `item.setOptions` fail with
   * `INVALID_ARGUMENT` unless the resulting item satisfies its catalog entry.
   */
  catalog?: Catalog;
};

export type Applied = { doc: DesignDocument; inverse: Command };
type Outcome = Result<Applied, CommandError>;

const fail = (code: CommandError['code'], message: string): Result<never, CommandError> =>
  err({ code, message });
const notFound = (what: string, id: Id) => fail('NOT_FOUND', `No ${what} has id "${id}".`);

/** Validates unknown input, such as an LLM tool call, as a command. */
export function parseCommand(input: unknown): Result<Command, CommandError> {
  const parsed = CommandSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const [first] = parsed.error.issues;
  const inBatch = first?.path[0] === 'commands' && typeof first.path[1] === 'number';
  return err({
    code: 'SCHEMA',
    message: `Invalid command: ${describeIssues(toIssues(parsed.error))}`,
    ...(inBatch && { commandIndex: first.path[1] as number }),
  });
}

/**
 * The only way to change a document. Returns a new document, which shares the parts the
 * command did not touch, and the command that undoes it exactly. Never mutates `doc`.
 *
 * Checks the command against its schema, then its references and arguments, then the
 * catalog if `context` has one. Design rules such as collisions are not checked here.
 */
export function applyCommand(
  doc: DesignDocument,
  cmd: Command,
  context: CommandContext = {},
): Outcome {
  const parsed = parseCommand(cmd);
  return parsed.ok ? applyValid(doc, parsed.value, context) : parsed;
}

// --- helpers ---------------------------------------------------------------------------

type Patch<T> = { [K in keyof T]?: T[K] | null | undefined };

/** A copy of `target` with each field of `patch` set; a null field is removed. */
function patched<T extends object>(target: T, patch: Patch<T>): T {
  const out = { ...target };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The patch that undoes `patch` on `target`: each field it touches, at its old value. */
function inversePatch<T extends object, P extends Patch<T>>(target: T, patch: P): P {
  const out: Patch<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined) out[key] = target[key] ?? null;
  }
  return out as P;
}

const insertAt = <T>(list: readonly T[], index: number, value: T): T[] => [
  ...list.slice(0, index),
  value,
  ...list.slice(index),
];
const removeAt = <T>(list: readonly T[], index: number): T[] => [
  ...list.slice(0, index),
  ...list.slice(index + 1),
];
const replaceAt = <T>(list: readonly T[], index: number, value: T): T[] => [
  ...list.slice(0, index),
  value,
  ...list.slice(index + 1),
];

const indexOfId = (list: readonly { id: Id }[], id: Id): number =>
  list.findIndex((entity) => entity.id === id);

const idInUse = (doc: DesignDocument, id: Id): boolean =>
  [doc.room.walls, doc.room.openings, doc.items, doc.countertops].some(
    (list) => indexOfId(list, id) !== -1,
  );

const hasWall = (doc: DesignDocument, id: Id): boolean => indexOfId(doc.room.walls, id) !== -1;

const withWalls = (doc: DesignDocument, walls: Wall[]): DesignDocument => ({
  ...doc,
  room: { ...doc.room, walls },
});
const withOpenings = (doc: DesignDocument, openings: Opening[]): DesignDocument => ({
  ...doc,
  room: { ...doc.room, openings },
});
const withItems = (doc: DesignDocument, items: Item[]): DesignDocument => ({ ...doc, items });
const withCountertops = (doc: DesignDocument, countertops: Countertop[]): DesignDocument => ({
  ...doc,
  countertops,
});

/** Checks a new entity's id and insert position, and returns the position. */
function insertion(
  doc: DesignDocument,
  list: readonly unknown[],
  id: Id,
  index: number | undefined,
): Result<number, CommandError> {
  if (idInUse(doc, id)) return fail('DUPLICATE_ID', `The id "${id}" is already in use.`);
  if (index !== undefined && index > list.length) {
    return fail('INVALID_ARGUMENT', `Index ${index} is past the end of the list.`);
  }
  return ok(index ?? list.length);
}

// --- one function per command ----------------------------------------------------------

function setCeilingHeight(doc: DesignDocument, cmd: CommandOf<'room.setCeilingHeight'>): Outcome {
  return ok({
    doc: { ...doc, room: { ...doc.room, ceilingHeight: cmd.height } },
    inverse: { type: 'room.setCeilingHeight', height: doc.room.ceilingHeight },
  });
}

function wallAdd(doc: DesignDocument, cmd: CommandOf<'wall.add'>): Outcome {
  const index = insertion(doc, doc.room.walls, cmd.wall.id, cmd.index);
  if (!index.ok) return index;
  if (isZeroLength(cmd.wall)) return fail('INVALID_ARGUMENT', 'A wall cannot have zero length.');
  return ok({
    doc: withWalls(doc, insertAt(doc.room.walls, index.value, cmd.wall)),
    inverse: { type: 'wall.remove', id: cmd.wall.id },
  });
}

function wallUpdate(doc: DesignDocument, cmd: CommandOf<'wall.update'>): Outcome {
  const index = indexOfId(doc.room.walls, cmd.id);
  const wall = doc.room.walls[index];
  if (!wall) return notFound('wall', cmd.id);
  const next = patched(wall, cmd.patch);
  if (isZeroLength(next)) return fail('INVALID_ARGUMENT', 'A wall cannot have zero length.');
  return ok({
    doc: withWalls(doc, replaceAt(doc.room.walls, index, next)),
    inverse: { type: 'wall.update', id: cmd.id, patch: inversePatch(wall, cmd.patch) },
  });
}

function wallRemove(doc: DesignDocument, cmd: CommandOf<'wall.remove'>): Outcome {
  const index = indexOfId(doc.room.walls, cmd.id);
  const wall = doc.room.walls[index];
  if (!wall) return notFound('wall', cmd.id);
  const onWall = doc.items.filter(
    (item) => item.placement.type === 'wall' && item.placement.wallId === cmd.id,
  );
  if (onWall.length > 0) {
    return fail(
      'WALL_HAS_ITEMS',
      `Wall "${cmd.id}" has ${onWall.length} item(s) placed on it. Move or remove them first.`,
    );
  }
  // Restoring the openings and countertops in ascending index order puts each back where
  // it was.
  const restore: Command[] = [];
  doc.room.openings.forEach((opening, i) => {
    if (opening.wallId === cmd.id) restore.push({ type: 'opening.add', opening, index: i });
  });
  const openingCount = restore.length;
  doc.countertops.forEach((countertop, i) => {
    if (countertop.wallId === cmd.id)
      restore.push({ type: 'countertop.add', countertop, index: i });
  });
  return ok({
    doc: {
      ...doc,
      room: {
        ...doc.room,
        walls: removeAt(doc.room.walls, index),
        // Keep sharing each list when the wall had nothing in it.
        openings:
          openingCount === 0
            ? doc.room.openings
            : doc.room.openings.filter((opening) => opening.wallId !== cmd.id),
      },
      countertops:
        restore.length === openingCount
          ? doc.countertops
          : doc.countertops.filter((countertop) => countertop.wallId !== cmd.id),
    },
    inverse: { type: 'batch', commands: [{ type: 'wall.add', wall, index }, ...restore] },
  });
}

function checkOpening(doc: DesignDocument, opening: Opening): Result<null, CommandError> {
  if (!hasWall(doc, opening.wallId)) return notFound('wall', opening.wallId);
  const problem = openingProblem(opening);
  return problem ? fail('INVALID_ARGUMENT', `${problem.message}.`) : ok(null);
}

function openingAdd(doc: DesignDocument, cmd: CommandOf<'opening.add'>): Outcome {
  const index = insertion(doc, doc.room.openings, cmd.opening.id, cmd.index);
  if (!index.ok) return index;
  const checked = checkOpening(doc, cmd.opening);
  if (!checked.ok) return checked;
  return ok({
    doc: withOpenings(doc, insertAt(doc.room.openings, index.value, cmd.opening)),
    inverse: { type: 'opening.remove', id: cmd.opening.id },
  });
}

function openingUpdate(doc: DesignDocument, cmd: CommandOf<'opening.update'>): Outcome {
  const index = indexOfId(doc.room.openings, cmd.id);
  const opening = doc.room.openings[index];
  if (!opening) return notFound('opening', cmd.id);
  const next = patched(opening, cmd.patch);
  const checked = checkOpening(doc, next);
  if (!checked.ok) return checked;
  return ok({
    doc: withOpenings(doc, replaceAt(doc.room.openings, index, next)),
    inverse: { type: 'opening.update', id: cmd.id, patch: inversePatch(opening, cmd.patch) },
  });
}

function openingRemove(doc: DesignDocument, cmd: CommandOf<'opening.remove'>): Outcome {
  const index = indexOfId(doc.room.openings, cmd.id);
  const opening = doc.room.openings[index];
  if (!opening) return notFound('opening', cmd.id);
  return ok({
    doc: withOpenings(doc, removeAt(doc.room.openings, index)),
    inverse: { type: 'opening.add', opening, index },
  });
}

function checkPlacement(doc: DesignDocument, placement: Item['placement']) {
  if (placement.type === 'wall' && !hasWall(doc, placement.wallId)) {
    return notFound('wall', placement.wallId);
  }
  return ok(null);
}

/** Checks an item against the catalog, when the caller gave one. */
function checkCatalog(item: Item, context: CommandContext): Result<Item, CommandError> {
  if (!context.catalog) return ok(item);
  const constraintErrors = checkItemAgainstCatalog(item, context.catalog);
  if (constraintErrors.length === 0) return ok(item);
  return err({
    code: 'INVALID_ARGUMENT',
    message: constraintErrors.map((error) => error.message).join(' '),
    constraintErrors,
  });
}

function itemAdd(
  doc: DesignDocument,
  cmd: CommandOf<'item.add'>,
  context: CommandContext,
): Outcome {
  const index = insertion(doc, doc.items, cmd.item.id, cmd.index);
  if (!index.ok) return index;
  const checked = checkPlacement(doc, cmd.item.placement);
  if (!checked.ok) return checked;
  const allowed = checkCatalog(cmd.item, context);
  if (!allowed.ok) return allowed;
  return ok({
    doc: withItems(doc, insertAt(doc.items, index.value, cmd.item)),
    inverse: { type: 'item.remove', id: cmd.item.id },
  });
}

/** Shared by the commands that change fields of one item. */
function updateItem(
  doc: DesignDocument,
  id: Id,
  change: (item: Item) => Result<{ item: Item; inverse: Command }, CommandError>,
): Outcome {
  const index = indexOfId(doc.items, id);
  const item = doc.items[index];
  if (!item) return notFound('item', id);
  const changed = change(item);
  if (!changed.ok) return changed;
  return ok({
    doc: withItems(doc, replaceAt(doc.items, index, changed.value.item)),
    inverse: changed.value.inverse,
  });
}

function itemMove(doc: DesignDocument, cmd: CommandOf<'item.move'>): Outcome {
  return updateItem(doc, cmd.id, (item) => {
    const checked = checkPlacement(doc, cmd.placement);
    if (!checked.ok) return checked;
    const { type, id, ...patch } = cmd;
    return ok({ item: patched(item, patch), inverse: { type, id, ...inversePatch(item, patch) } });
  });
}

function itemResize(
  doc: DesignDocument,
  cmd: CommandOf<'item.resize'>,
  context: CommandContext,
): Outcome {
  return updateItem(doc, cmd.id, (item) => {
    const { type, id, ...patch } = cmd;
    const next = checkCatalog(patched(item, patch), context);
    if (!next.ok) return next;
    return ok({ item: next.value, inverse: { type, id, ...inversePatch(item, patch) } });
  });
}

function itemSetOptions(
  doc: DesignDocument,
  cmd: CommandOf<'item.setOptions'>,
  context: CommandContext,
): Outcome {
  return updateItem(doc, cmd.id, (item) => {
    const { type, id, options, ...patch } = cmd;
    const next = checkCatalog(
      { ...patched(item, patch), options: patched(item.options, options) },
      context,
    );
    if (!next.ok) return next;
    return ok({
      item: next.value,
      inverse: {
        type,
        id,
        options: inversePatch(item.options, options),
        ...inversePatch(item, patch),
      },
    });
  });
}

function itemRemove(doc: DesignDocument, cmd: CommandOf<'item.remove'>): Outcome {
  const index = indexOfId(doc.items, cmd.id);
  const item = doc.items[index];
  if (!item) return notFound('item', cmd.id);
  return ok({
    doc: withItems(doc, removeAt(doc.items, index)),
    inverse: { type: 'item.add', item, index },
  });
}

function checkCountertop(doc: DesignDocument, countertop: Countertop): Result<null, CommandError> {
  if (!hasWall(doc, countertop.wallId)) return notFound('wall', countertop.wallId);
  const problem = countertopProblem(countertop);
  return problem ? fail('INVALID_ARGUMENT', `${problem.message}.`) : ok(null);
}

function countertopAdd(doc: DesignDocument, cmd: CommandOf<'countertop.add'>): Outcome {
  const index = insertion(doc, doc.countertops, cmd.countertop.id, cmd.index);
  if (!index.ok) return index;
  const checked = checkCountertop(doc, cmd.countertop);
  if (!checked.ok) return checked;
  return ok({
    doc: withCountertops(doc, insertAt(doc.countertops, index.value, cmd.countertop)),
    inverse: { type: 'countertop.remove', id: cmd.countertop.id },
  });
}

function countertopUpdate(doc: DesignDocument, cmd: CommandOf<'countertop.update'>): Outcome {
  const index = indexOfId(doc.countertops, cmd.id);
  const countertop = doc.countertops[index];
  if (!countertop) return notFound('countertop', cmd.id);
  const next = patched(countertop, cmd.patch);
  const checked = checkCountertop(doc, next);
  if (!checked.ok) return checked;
  return ok({
    doc: withCountertops(doc, replaceAt(doc.countertops, index, next)),
    inverse: { type: 'countertop.update', id: cmd.id, patch: inversePatch(countertop, cmd.patch) },
  });
}

function countertopRemove(doc: DesignDocument, cmd: CommandOf<'countertop.remove'>): Outcome {
  const index = indexOfId(doc.countertops, cmd.id);
  const countertop = doc.countertops[index];
  if (!countertop) return notFound('countertop', cmd.id);
  return ok({
    doc: withCountertops(doc, removeAt(doc.countertops, index)),
    inverse: { type: 'countertop.add', countertop, index },
  });
}

function finishSet(doc: DesignDocument, cmd: CommandOf<'finish.set'>): Outcome {
  const patch = { [cmd.target]: cmd.finishId };
  return ok({
    doc: { ...doc, finishes: patched(doc.finishes, patch) },
    inverse: {
      type: 'finish.set',
      target: cmd.target,
      finishId: doc.finishes[cmd.target] ?? null,
    },
  });
}

function documentRename(doc: DesignDocument, cmd: CommandOf<'document.rename'>): Outcome {
  return ok({
    doc: { ...doc, name: cmd.name },
    inverse: { type: 'document.rename', name: doc.name },
  });
}

function batch(doc: DesignDocument, cmd: CommandOf<'batch'>, context: CommandContext): Outcome {
  let current = doc;
  const inverses: Command[] = [];
  for (const [commandIndex, command] of cmd.commands.entries()) {
    const applied = applyValid(current, command, context);
    // `doc` is untouched, so stopping here applies nothing.
    if (!applied.ok) return err({ ...applied.error, commandIndex });
    current = applied.value.doc;
    inverses.unshift(applied.value.inverse);
  }
  return ok({
    doc: current,
    inverse: {
      type: 'batch',
      commands: inverses,
      ...(cmd.label !== undefined && { label: cmd.label }),
    },
  });
}

/** Applies a command that already passed its schema. */
function applyValid(doc: DesignDocument, cmd: Command, context: CommandContext): Outcome {
  switch (cmd.type) {
    case 'room.setCeilingHeight':
      return setCeilingHeight(doc, cmd);
    case 'wall.add':
      return wallAdd(doc, cmd);
    case 'wall.update':
      return wallUpdate(doc, cmd);
    case 'wall.remove':
      return wallRemove(doc, cmd);
    case 'opening.add':
      return openingAdd(doc, cmd);
    case 'opening.update':
      return openingUpdate(doc, cmd);
    case 'opening.remove':
      return openingRemove(doc, cmd);
    case 'item.add':
      return itemAdd(doc, cmd, context);
    case 'item.move':
      return itemMove(doc, cmd);
    case 'item.resize':
      return itemResize(doc, cmd, context);
    case 'item.setOptions':
      return itemSetOptions(doc, cmd, context);
    case 'item.remove':
      return itemRemove(doc, cmd);
    case 'countertop.add':
      return countertopAdd(doc, cmd);
    case 'countertop.update':
      return countertopUpdate(doc, cmd);
    case 'countertop.remove':
      return countertopRemove(doc, cmd);
    case 'finish.set':
      return finishSet(doc, cmd);
    case 'document.rename':
      return documentRename(doc, cmd);
    case 'batch':
      return batch(doc, cmd, context);
  }
}
