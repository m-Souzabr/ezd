import { z } from 'zod';

import { type Issue, issuePath } from '../issues.js';

/** Current Design Document schema version. */
export const SCHEMA_VERSION = 1;

/** Any length or coordinate: an integer count of sixteenths of an inch. */
export const LenSchema = z.number().int();
/** A size, which must be greater than zero. */
export const PositiveLenSchema = LenSchema.positive();
/** A distance from an origin (an offset, an elevation), which may be zero. */
export const NonNegativeLenSchema = LenSchema.nonnegative();

/** Client-generated and URL-safe. */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,36}$/, 'Invalid id');

/** Plan coordinates: x to the right, y down. */
export const PointSchema = z.strictObject({ x: LenSchema, y: LenSchema }).meta({ id: 'Point' });

export const WallSchema = z
  .strictObject({
    id: IdSchema,
    /** `start` to `end` is the interior face of the wall. */
    start: PointSchema,
    end: PointSchema,
    /** Extends away from the room. */
    thickness: PositiveLenSchema,
    /** Defaults to `room.ceilingHeight`. */
    height: PositiveLenSchema.optional(),
  })
  .meta({ id: 'Wall' });

export const OpeningKindSchema = z.enum(['door', 'window', 'passage']);
export const SwingSchema = z.enum(['in-left', 'in-right', 'out-left', 'out-right']);

export const OpeningSchema = z
  .strictObject({
    id: IdSchema,
    wallId: IdSchema,
    kind: OpeningKindSchema,
    /** From the wall start, along the wall. */
    offset: NonNegativeLenSchema,
    width: PositiveLenSchema,
    height: PositiveLenSchema,
    /** 0 for doors and passages. */
    sillHeight: NonNegativeLenSchema,
    /** Doors only. */
    swing: SwingSchema.optional(),
  })
  .meta({ id: 'Opening' });

export const PlacementSchema = z
  .discriminatedUnion('type', [
    /** Back against a wall, left edge at `offset` from the wall start. */
    z.strictObject({ type: z.literal('wall'), wallId: IdSchema, offset: NonNegativeLenSchema }),
    /**
     * Anywhere in the room. (x, y) is the back left corner; `rotation` turns the item
     * clockwise as seen from above, in integer degrees. At 0 the back runs along +x and
     * the item extends toward +y, like an item on a wall that runs left to right.
     */
    z.strictObject({
      type: z.literal('free'),
      x: LenSchema,
      y: LenSchema,
      rotation: z.number().int().min(0).max(359),
    }),
  ])
  .meta({ id: 'Placement' });

export const ItemKindSchema = z.enum([
  'base',
  'wall',
  'tall',
  'corner',
  'appliance',
  'filler',
  'panel',
]);

export const OptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const ItemSchema = z
  .strictObject({
    id: IdSchema,
    catalogId: z.string().min(1),
    kind: ItemKindSchema,
    width: PositiveLenSchema,
    height: PositiveLenSchema,
    depth: PositiveLenSchema,
    /** Bottom of the item above the floor. */
    elevation: NonNegativeLenSchema,
    placement: PlacementSchema,
    options: z.record(z.string(), OptionValueSchema),
    finishId: z.string().min(1).optional(),
  })
  .meta({ id: 'Item' });

export const DocumentNameSchema = z.string().min(1).max(200);

export const DesignDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: IdSchema,
    name: DocumentNameSchema,
    room: z.strictObject({
      ceilingHeight: PositiveLenSchema,
      /** Clockwise as seen from above. */
      walls: z.array(WallSchema),
      openings: z.array(OpeningSchema),
    }),
    items: z.array(ItemSchema),
  })
  .superRefine((doc, ctx) => {
    for (const issue of findIntegrityIssues(doc)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });

export type Id = z.infer<typeof IdSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type OpeningKind = z.infer<typeof OpeningKindSchema>;
export type Swing = z.infer<typeof SwingSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type ItemKind = z.infer<typeof ItemKindSchema>;
export type OptionValue = z.infer<typeof OptionValueSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;

export const isZeroLength = (wall: Pick<Wall, 'start' | 'end'>): boolean =>
  wall.start.x === wall.end.x && wall.start.y === wall.end.y;

/** What is wrong with an opening's own fields, or null. Shared with the command layer. */
export function openingProblem(
  opening: Pick<Opening, 'kind' | 'sillHeight' | 'swing'>,
): { field: 'sillHeight' | 'swing'; message: string } | null {
  if (opening.kind !== 'door' && opening.swing !== undefined) {
    return { field: 'swing', message: `Only doors have a swing, not a ${opening.kind}` };
  }
  if (opening.kind !== 'window' && opening.sillHeight !== 0) {
    return { field: 'sillHeight', message: `A ${opening.kind} has a sill height of 0` };
  }
  return null;
}

type PathIssue = { path: (string | number)[]; message: string };

/**
 * Checks what a schema alone cannot: ids are unique across walls, openings and items,
 * every `wallId` exists, and every wall has a length.
 */
function findIntegrityIssues(doc: z.infer<typeof DesignDocumentSchema>): PathIssue[] {
  const issues: PathIssue[] = [];
  const seen = new Set<Id>();
  const claim = (id: Id, path: (string | number)[]) => {
    if (seen.has(id)) issues.push({ path: [...path, 'id'], message: `Duplicate id "${id}"` });
    seen.add(id);
  };
  const wallIds = new Set(doc.room.walls.map((wall) => wall.id));
  const requireWall = (wallId: Id, path: (string | number)[]) => {
    if (!wallIds.has(wallId)) issues.push({ path, message: `No wall has id "${wallId}"` });
  };

  doc.room.walls.forEach((wall, i) => {
    claim(wall.id, ['room', 'walls', i]);
    if (isZeroLength(wall)) {
      issues.push({ path: ['room', 'walls', i, 'end'], message: 'Wall has zero length' });
    }
  });
  doc.room.openings.forEach((opening, i) => {
    claim(opening.id, ['room', 'openings', i]);
    requireWall(opening.wallId, ['room', 'openings', i, 'wallId']);
    const problem = openingProblem(opening);
    if (problem) {
      issues.push({ path: ['room', 'openings', i, problem.field], message: problem.message });
    }
  });
  doc.items.forEach((item, i) => {
    claim(item.id, ['items', i]);
    if (item.placement.type === 'wall') {
      requireWall(item.placement.wallId, ['items', i, 'placement', 'wallId']);
    }
  });
  return issues;
}

/** Converts a Zod error to core's own issue list. */
export function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({
    path: issuePath(issue.path),
    message: issue.message,
  }));
}
