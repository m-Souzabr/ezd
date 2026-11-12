import { describe, expect, it } from 'vitest';

import { inches } from '../units/index.js';
import { clone, fixtures, sampleDocument } from '../test/fixtures.js';
import {
  type Countertop,
  createEmptyDocument,
  type DesignDocument,
  parseDocument,
} from './index.js';
import { migrate, migrateWith } from './migrate.js';

/** The valid fixture as `parseDocument` returns it, with the defaults filled in. */
const validParsed = { ...fixtures.valid, countertops: [], finishes: {} };

/** A plain, editable copy of the sample document. */
const editable = (): DesignDocument => clone(sampleDocument());

const countertop: Countertop = {
  id: 'countertop-01',
  wallId: 'wall-north',
  startOffset: 0,
  endOffset: inches(48),
  depth: inches(25.5),
  thickness: inches(1.5),
  elevation: inches(34.5),
};

function issuesOf(input: unknown) {
  const result = parseDocument(input);
  if (result.ok) throw new Error('expected the document to be rejected');
  expect(result.error.code).toBe('SCHEMA');
  return result.error;
}

describe('createEmptyDocument', () => {
  it('returns a valid document with a 96 in ceiling and no walls', () => {
    const doc = createEmptyDocument({ id: 'doc-00000001', name: 'New kitchen' });
    expect(doc.room.ceilingHeight).toBe(inches(96));
    expect(doc.room.walls).toEqual([]);
    expect(doc.items).toEqual([]);
    expect(doc.countertops).toEqual([]);
    expect(doc.finishes).toEqual({});
    expect(parseDocument(doc)).toEqual({ ok: true, value: doc });
  });
});

describe('parseDocument', () => {
  it('accepts the valid fixture, defaulting countertops and finishes', () => {
    expect(fixtures.valid).not.toHaveProperty('countertops');
    expect(parseDocument(fixtures.valid)).toEqual({ ok: true, value: validParsed });
  });

  it('accepts countertops and finishes', () => {
    const doc = editable();
    doc.countertops.push(countertop);
    doc.finishes = { cabinet: 'cabinet.white', floor: 'floor.oak' };
    expect(parseDocument(doc)).toEqual({ ok: true, value: doc });
  });

  it('rejects a countertop with a duplicate id, a missing wall or no length', () => {
    const doc = editable();
    doc.countertops.push(
      { ...countertop, id: 'wall-north' },
      { ...countertop, wallId: 'wall-missing' },
      { ...countertop, id: 'countertop-02', startOffset: inches(48) },
    );
    expect(issuesOf(doc).issues).toEqual([
      { path: 'countertops[0].id', message: 'Duplicate id "wall-north"' },
      { path: 'countertops[1].wallId', message: 'No wall has id "wall-missing"' },
      { path: 'countertops[2].endOffset', message: 'A countertop ends after it starts' },
    ]);
  });

  it('rejects an unknown finish target', () => {
    const doc = { ...editable(), finishes: { ceiling: 'wall.white' } };
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual(['finishes']);
  });

  it('rejects a duplicate id, naming the second use', () => {
    const error = issuesOf(fixtures.duplicateId);
    expect(error.issues).toEqual([{ path: 'items[1].id', message: 'Duplicate id "wall-east"' }]);
    expect(error.message).toContain('items[1].id');
  });

  it('rejects a dangling wallId on an item', () => {
    expect(issuesOf(fixtures.danglingWallId).issues).toEqual([
      { path: 'items[2].placement.wallId', message: 'No wall has id "wall-missing"' },
    ]);
  });

  it('rejects a dangling wallId on an opening', () => {
    const doc = editable();
    doc.room.openings[0]!.wallId = 'wall-missing';
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual(['room.openings[0].wallId']);
  });

  it('rejects a float length', () => {
    expect(issuesOf(fixtures.floatLength).issues.map((issue) => issue.path)).toEqual([
      'items[0].width',
    ]);
  });

  it('rejects a zero-length wall', () => {
    expect(issuesOf(fixtures.zeroLengthWall).issues).toEqual([
      { path: 'room.walls[3].end', message: 'Wall has zero length' },
    ]);
  });

  it('rejects a swing on anything but a door', () => {
    const doc = editable();
    doc.room.openings[1]!.swing = 'in-left';
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual(['room.openings[1].swing']);
  });

  it('rejects a sill height on a door', () => {
    const doc = editable();
    doc.room.openings[0]!.sillHeight = inches(4);
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual([
      'room.openings[0].sillHeight',
    ]);
  });

  it.each([
    ['an unknown key', (doc: Record<string, unknown>) => (doc.extra = true), ''],
    ['a short id', (doc: Record<string, unknown>) => (doc.id = 'short'), 'id'],
    [
      'an id that is not URL-safe',
      (doc: Record<string, unknown>) => (doc.id = 'has space 1'),
      'id',
    ],
    ['an empty name', (doc: Record<string, unknown>) => (doc.name = ''), 'name'],
    [
      'a future schema version',
      (doc: Record<string, unknown>) => (doc.schemaVersion = 2),
      'schemaVersion',
    ],
  ])('rejects %s', (_label, change, path) => {
    const doc = editable() as unknown as Record<string, unknown>;
    change(doc);
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual([path]);
  });

  it.each([
    [
      'a zero ceiling height',
      (doc: DesignDocument) => (doc.room.ceilingHeight = 0),
      'room.ceilingHeight',
    ],
    ['a zero item width', (doc: DesignDocument) => (doc.items[0]!.width = 0), 'items[0].width'],
    [
      'a negative elevation',
      (doc: DesignDocument) => (doc.items[0]!.elevation = -1),
      'items[0].elevation',
    ],
    [
      'a negative wall offset',
      (doc: DesignDocument) => (doc.room.openings[0]!.offset = -1),
      'room.openings[0].offset',
    ],
    [
      'a zero wall thickness',
      (doc: DesignDocument) => (doc.room.walls[0]!.thickness = 0),
      'room.walls[0].thickness',
    ],
    [
      'a rotation of 360',
      (doc: DesignDocument) =>
        (doc.items[3]!.placement = { type: 'free', x: 0, y: 0, rotation: 360 }),
      'items[3].placement.rotation',
    ],
    [
      'a fractional rotation',
      (doc: DesignDocument) =>
        (doc.items[3]!.placement = { type: 'free', x: 0, y: 0, rotation: 0.5 }),
      'items[3].placement.rotation',
    ],
  ])('rejects %s', (_label, change, path) => {
    const doc = editable();
    change(doc);
    expect(issuesOf(doc).issues.map((issue) => issue.path)).toEqual([path]);
  });

  it('rejects input that is not an object', () => {
    expect(issuesOf(null).issues).toHaveLength(1);
    expect(issuesOf('{}').issues).toHaveLength(1);
  });
});

describe('migrate', () => {
  it('returns a version 1 document, with its defaults filled in', () => {
    expect(migrate(fixtures.valid)).toEqual({ ok: true, value: validParsed });
  });

  it.each([
    ['null', null],
    ['a string', 'document'],
    ['an object without a version', { name: 'x' }],
    ['a fractional version', { schemaVersion: 1.5 }],
  ])('rejects %s as not a document', (_label, input) => {
    expect(migrate(input)).toMatchObject({ ok: false, error: { code: 'NOT_A_DOCUMENT' } });
  });

  it('rejects a newer version', () => {
    expect(migrate({ ...fixtures.valid, schemaVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: 'NEWER_VERSION' },
    });
  });

  it('rejects an unknown version', () => {
    expect(migrate({ ...fixtures.valid, schemaVersion: 0 })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_VERSION' },
    });
  });

  it('rejects a version 1 document that is invalid, with its issues', () => {
    expect(migrate(fixtures.duplicateId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', issues: [{ path: 'items[1].id' }] },
    });
  });

  it('runs each registered step up to the current version', () => {
    // A made-up version 0 that called the document name "title".
    const registry = {
      0: ({ title, ...rest }: Record<string, unknown>) => ({
        ...rest,
        name: title,
        schemaVersion: 1,
      }),
      1: (doc: Record<string, unknown>) => doc,
    };
    const { name, ...rest } = fixtures.valid;
    const old = { ...rest, title: name, schemaVersion: 0 };
    expect(migrateWith(registry, 1, old)).toEqual({ ok: true, value: validParsed });
  });

  it('stops when a step does not advance the version', () => {
    const registry = { 0: (doc: Record<string, unknown>) => doc };
    expect(migrateWith(registry, 1, { schemaVersion: 0 })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_VERSION' },
    });
    const dropsVersion = { 0: () => ({}) };
    expect(migrateWith(dropsVersion, 1, { schemaVersion: 0 })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_VERSION' },
    });
  });
});
