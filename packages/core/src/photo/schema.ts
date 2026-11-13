import { z } from 'zod';

import {
  ItemKindSchema,
  LenSchema,
  NonNegativeLenSchema,
  OpeningKindSchema,
  PositiveLenSchema,
} from '../document/index.js';

// Two shapes of the same room. `DraftRoom` is what the vision model answers, in inches, as
// the vendor's structured output; nothing in it is trusted. `normalizeDraft` turns it into
// a `RoomDraft`: lengths in `Len`, cabinets snapped to the catalog, and every value the
// model supplied marked as an estimate until the user types or confirms it. The server
// stores the `RoomDraft`, the correction screen edits it, and `draftToCommands` builds the
// design from it.

export const DraftShapeSchema = z.enum([
  'single-wall',
  'galley',
  'l-shape',
  'u-shape',
  'rectangle',
  'unknown',
]);
export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const DraftCategorySchema = z.enum([
  'base',
  'wall',
  'tall',
  'range',
  'fridge',
  'dishwasher',
  'sink',
  'hood',
  'microwave',
]);

export const MAX_DRAFT_WALLS = 8;
export const MAX_DRAFT_OPENINGS = 20;
export const MAX_DRAFT_ITEMS = 60;
export const MAX_DRAFT_NOTES = 2000;

/** Inches the model could not see are null. Kept to `minimum: 0` for strict structured output. */
const ModelInches = z.number().nonnegative().nullable();
const ModelWallLabel = z.string().min(1).max(20);

/** The vision model's answer. Every field is required, as strict structured output wants. */
export const DraftRoomSchema = z.strictObject({
  shape: DraftShapeSchema,
  ceilingHeightIn: ModelInches,
  walls: z
    .array(
      z.strictObject({
        label: ModelWallLabel,
        lengthIn: ModelInches,
        visible: z.boolean(),
        confidence: ConfidenceSchema,
      }),
    )
    .max(MAX_DRAFT_WALLS),
  openings: z
    .array(
      z.strictObject({
        wall: ModelWallLabel,
        kind: OpeningKindSchema,
        offsetIn: ModelInches,
        widthIn: ModelInches,
        heightIn: ModelInches,
        sillIn: ModelInches,
        confidence: ConfidenceSchema,
      }),
    )
    .max(MAX_DRAFT_OPENINGS),
  items: z
    .array(
      z.strictObject({
        wall: ModelWallLabel,
        category: DraftCategorySchema,
        offsetIn: ModelInches,
        widthIn: ModelInches,
        confidence: ConfidenceSchema,
      }),
    )
    .max(MAX_DRAFT_ITEMS),
  notes: z.string().max(MAX_DRAFT_NOTES),
});

/**
 * A length of the draft. `estimated` is true while the value came from the model or a
 * catalog default and the user has neither typed nor confirmed it. Null is unknown.
 */
export const DraftLenSchema = z
  .strictObject({ value: NonNegativeLenSchema.nullable(), estimated: z.boolean() })
  .meta({ id: 'DraftLen' });

/** Walls are labelled A, B, C in order, as in the editor. */
const WallLabel = z.string().regex(/^[A-Z]$/);

export const RoomDraftSchema = z
  .strictObject({
    shape: DraftShapeSchema,
    ceilingHeight: DraftLenSchema,
    walls: z
      .array(
        z.strictObject({
          label: WallLabel,
          length: DraftLenSchema,
          visible: z.boolean(),
          confidence: ConfidenceSchema,
        }),
      )
      .max(MAX_DRAFT_WALLS),
    /** The distance between the two walls of a galley. Unused by other shapes. */
    galleyWidth: DraftLenSchema,
    openings: z
      .array(
        z.strictObject({
          wall: WallLabel,
          kind: OpeningKindSchema,
          offset: DraftLenSchema,
          width: DraftLenSchema,
          height: DraftLenSchema,
          sillHeight: DraftLenSchema,
          confidence: ConfidenceSchema,
        }),
      )
      .max(MAX_DRAFT_OPENINGS),
    items: z
      .array(
        z.strictObject({
          wall: WallLabel,
          category: DraftCategorySchema,
          catalogId: z.string().min(1),
          kind: ItemKindSchema,
          offset: DraftLenSchema,
          width: DraftLenSchema,
          /** Standard values from the catalog entry; the photo never sets them. */
          height: PositiveLenSchema,
          depth: PositiveLenSchema,
          elevation: LenSchema.nonnegative(),
          confidence: ConfidenceSchema,
        }),
      )
      .max(MAX_DRAFT_ITEMS),
    notes: z.string().max(MAX_DRAFT_NOTES),
  })
  .meta({ id: 'RoomDraft' });

export type DraftShape = z.infer<typeof DraftShapeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type DraftCategory = z.infer<typeof DraftCategorySchema>;
export type DraftRoom = z.infer<typeof DraftRoomSchema>;
export type DraftLen = z.infer<typeof DraftLenSchema>;
export type RoomDraft = z.infer<typeof RoomDraftSchema>;
export type DraftWall = RoomDraft['walls'][number];
export type DraftOpening = RoomDraft['openings'][number];
export type DraftItem = RoomDraft['items'][number];
