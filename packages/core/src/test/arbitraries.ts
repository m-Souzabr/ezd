import fc from 'fast-check';

import { applyCommand, type Command } from '../commands/index.js';
import type { DesignDocument, Id, Item, Opening, Wall } from '../document/index.js';
import { clone } from './fixtures.js';

// Arbitraries for property tests: random valid documents, and random commands that are
// valid for a given document.

const coordinate = fc.integer({ min: -4000, max: 4000 });
const size = fc.integer({ min: 1, max: 2000 });
const distance = fc.integer({ min: 0, max: 2000 });
const point = fc.record({ x: coordinate, y: coordinate });
const optionKey = fc.constantFrom('doors', 'hinge', 'softClose', 'note');
const optionValue = fc.oneof(fc.string(), fc.integer(), fc.boolean());
const finishId = fc.constantFrom('white-shaker', 'oak', 'navy');
const swing = fc.constantFrom('in-left', 'in-right', 'out-left', 'out-right');
const itemKind = fc.constantFrom('base', 'wall', 'tall', 'corner', 'appliance', 'filler', 'panel');

/** An id for a new entity. Practically never one the document already uses. */
const newId: fc.Arbitrary<Id> = fc.uuid();

const wall = (id: fc.Arbitrary<Id>): fc.Arbitrary<Wall> =>
  fc
    .record(
      { id, start: point, end: point, thickness: size, height: size },
      { requiredKeys: ['id', 'start', 'end', 'thickness'] },
    )
    .filter((w) => w.start.x !== w.end.x || w.start.y !== w.end.y);

const opening = (id: fc.Arbitrary<Id>, wallIds: Id[]): fc.Arbitrary<Opening> => {
  const common = {
    id,
    wallId: fc.constantFrom(...wallIds),
    offset: distance,
    width: size,
    height: size,
  };
  return fc.oneof(
    fc.record(
      { ...common, kind: fc.constant('door'), sillHeight: fc.constant(0), swing },
      { requiredKeys: ['id', 'wallId', 'offset', 'width', 'height', 'kind', 'sillHeight'] },
    ),
    fc.record({ ...common, kind: fc.constant('window'), sillHeight: distance }),
    fc.record({ ...common, kind: fc.constant('passage'), sillHeight: fc.constant(0) }),
  );
};

const placement = (wallIds: Id[]): fc.Arbitrary<Item['placement']> => {
  const free = fc.record({
    type: fc.constant('free'),
    x: coordinate,
    y: coordinate,
    rotation: fc.integer({ min: 0, max: 359 }),
  });
  if (wallIds.length === 0) return free;
  const onWall = fc.record({
    type: fc.constant('wall'),
    wallId: fc.constantFrom(...wallIds),
    offset: distance,
  });
  return fc.oneof(free, onWall);
};

const item = (id: fc.Arbitrary<Id>, wallIds: Id[]): fc.Arbitrary<Item> =>
  fc.record(
    {
      id,
      catalogId: fc.constantFrom('base-1-door', 'wall-2-door', 'filler'),
      kind: itemKind,
      width: size,
      height: size,
      depth: size,
      elevation: distance,
      placement: placement(wallIds),
      options: fc.dictionary(optionKey, optionValue),
      finishId,
    },
    {
      requiredKeys: [
        'id',
        'catalogId',
        'kind',
        'width',
        'height',
        'depth',
        'elevation',
        'placement',
        'options',
      ],
    },
  );

const numbered = (prefix: string, i: number): fc.Arbitrary<Id> =>
  fc.constant(`${prefix}-${String(i).padStart(6, '0')}`);

/** A random valid document with up to four walls, three openings and four items. */
export const documentArb: fc.Arbitrary<DesignDocument> = fc
  .tuple(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 3 }),
    fc.integer({ min: 0, max: 4 }),
  )
  .chain(([wallCount, openingCount, itemCount]) => {
    const wallIds = Array.from(
      { length: wallCount },
      (_, i) => `wall-${String(i).padStart(6, '0')}`,
    );
    const indexes = (count: number) => Array.from({ length: count }, (_, i) => i);
    return fc.record({
      schemaVersion: fc.constant(1 as const),
      id: fc.constant('doc-000001'),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      room: fc.record({
        ceilingHeight: size,
        walls: fc.tuple(...wallIds.map((id) => wall(fc.constant(id)))),
        openings: fc.tuple(
          ...indexes(wallCount === 0 ? 0 : openingCount).map((i) =>
            opening(numbered('opening', i), wallIds),
          ),
        ),
      }),
      items: fc.tuple(...indexes(itemCount).map((i) => item(numbered('item', i), wallIds))),
    });
  })
  // fast-check builds objects that JSON never would (null prototypes, undefined values).
  .map(clone);

const insertIndex = (list: readonly unknown[]) =>
  fc.option(fc.integer({ min: 0, max: list.length }), { nil: undefined });

/** Every key optional. */
const partial = <T>(model: { [K in keyof T]: fc.Arbitrary<T[K]> }) =>
  fc.record(model, { requiredKeys: [] });

function simpleCommands(doc: DesignDocument): fc.Arbitrary<Command>[] {
  const { walls, openings } = doc.room;
  const wallIds = walls.map((w) => w.id);
  const applies = (cmd: Command) => applyCommand(doc, cmd).ok;

  const commands: fc.Arbitrary<Command>[] = [
    fc.record({ type: fc.constant('room.setCeilingHeight'), height: size }),
    fc.record({
      type: fc.constant('document.rename'),
      name: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    fc.record({ type: fc.constant('wall.add'), wall: wall(newId), index: insertIndex(walls) }),
    fc.record({
      type: fc.constant('item.add'),
      item: item(newId, wallIds),
      index: insertIndex(doc.items),
    }),
  ];

  if (walls.length > 0) {
    const occupied = new Set(
      doc.items.flatMap((i) => (i.placement.type === 'wall' ? [i.placement.wallId] : [])),
    );
    const removable = wallIds.filter((id) => !occupied.has(id));
    commands.push(
      fc
        .record({
          type: fc.constant('wall.update'),
          id: fc.constantFrom(...wallIds),
          patch: partial({
            start: point,
            end: point,
            thickness: size,
            height: fc.option(size, { nil: null }),
          }),
        })
        .filter(applies),
      fc.record({
        type: fc.constant('opening.add'),
        opening: opening(newId, wallIds),
        index: insertIndex(openings),
      }),
    );
    if (removable.length > 0) {
      commands.push(
        fc.record({ type: fc.constant('wall.remove'), id: fc.constantFrom(...removable) }),
      );
    }
  }

  if (openings.length > 0) {
    const openingId = fc.constantFrom(...openings.map((o) => o.id));
    commands.push(
      fc.record({ type: fc.constant('opening.remove'), id: openingId }),
      // Sizes and position only, which are always valid.
      fc.record({
        type: fc.constant('opening.update'),
        id: openingId,
        patch: partial({
          wallId: fc.constantFrom(...wallIds),
          offset: distance,
          width: size,
          height: size,
        }),
      }),
      // Any field. Many combinations are invalid (a swing on a window), so keep the rest.
      fc
        .record({
          type: fc.constant('opening.update'),
          id: openingId,
          patch: partial({
            kind: fc.constantFrom('door', 'window', 'passage'),
            sillHeight: fc.oneof(fc.constant(0), distance),
            swing: fc.option(swing, { nil: null }),
          }),
        })
        .filter(applies),
    );
  }

  if (doc.items.length > 0) {
    const itemId = fc.constantFrom(...doc.items.map((i) => i.id));
    commands.push(
      fc.record({ type: fc.constant('item.remove'), id: itemId }),
      fc.record(
        {
          type: fc.constant('item.move'),
          id: itemId,
          placement: placement(wallIds),
          elevation: distance,
        },
        { requiredKeys: ['type', 'id', 'placement'] },
      ),
      fc.record(
        { type: fc.constant('item.resize'), id: itemId, width: size, height: size, depth: size },
        { requiredKeys: ['type', 'id'] },
      ),
      fc.record(
        {
          type: fc.constant('item.setOptions'),
          id: itemId,
          options: fc.dictionary(optionKey, fc.option(optionValue, { nil: null })),
          finishId: fc.option(finishId, { nil: null }),
        },
        { requiredKeys: ['type', 'id', 'options'] },
      ),
    );
  }
  return commands;
}

/** A sequence of commands, each valid for the document the ones before it produce. */
function sequence(doc: DesignDocument, length: number, depth: number): fc.Arbitrary<Command[]> {
  if (length === 0) return fc.constant([]);
  return commandArb(doc, depth).chain((cmd) => {
    const applied = applyCommand(doc, cmd);
    if (!applied.ok) throw new Error(`generated an invalid command: ${applied.error.message}`);
    return sequence(applied.value.doc, length - 1, depth).map((rest) => [cmd, ...rest]);
  });
}

/** A random command that is valid for `doc`, including batches nested up to `depth`. */
export function commandArb(doc: DesignDocument, depth = 2): fc.Arbitrary<Command> {
  const simple = simpleCommands(doc).map((arbitrary) => ({
    arbitrary: arbitrary.map(clone),
    weight: 3,
  }));
  if (depth === 0) return fc.oneof(...simple);
  const batch = fc.integer({ min: 0, max: 4 }).chain((length) =>
    fc
      .record({
        type: fc.constant('batch'),
        commands: sequence(doc, length, depth - 1),
        label: fc.option(fc.string(), { nil: undefined }),
      })
      .map(clone),
  );
  return fc.oneof(...simple, { arbitrary: batch, weight: 4 });
}

/** A random valid document together with a command that is valid for it. */
export const documentAndCommandArb = documentArb.chain((doc) =>
  commandArb(doc).map((cmd) => ({ doc, cmd })),
);
