import { z } from 'zod';

import { FinishTargetSchema, ItemKindSchema, LenSchema } from '../document/schema.js';

// The catalog as data. Structure only: `catalogData/validate.ts` checks what a schema
// cannot (sizes against their lists, ids against the code that depends on them).

export const WidthRuleSchema = z
  .union([
    z.strictObject({ min: LenSchema, max: LenSchema, step: LenSchema }),
    z.strictObject({ values: z.array(LenSchema) }),
    z.strictObject({ free: z.strictObject({ min: LenSchema, max: LenSchema }) }),
  ])
  .meta({ id: 'WidthRule' });

export const OptionDefSchema = z
  .union([
    z.strictObject({
      key: z.string(),
      type: z.literal('enum'),
      values: z.array(z.string()),
      default: z.string(),
    }),
    z.strictObject({
      key: z.string(),
      type: z.literal('int'),
      values: z.array(z.number().int()),
      default: z.number().int(),
    }),
    z.strictObject({
      key: z.string(),
      type: z.literal('int'),
      range: z.strictObject({ min: z.number().int(), max: z.number().int() }),
      default: z.number().int(),
    }),
    z.strictObject({ key: z.string(), type: z.literal('bool'), default: z.boolean() }),
  ])
  .meta({ id: 'OptionDef' });

export const CornerShapeSchema = z.enum(['blind', 'l', 'diagonal']);

export const CatalogEntrySchema = z
  .strictObject({
    /** For example `base.standard`. */
    id: z.string(),
    kind: ItemKindSchema,
    name: z.string(),
    width: WidthRuleSchema,
    heights: z.array(LenSchema),
    depths: z.array(LenSchema),
    /** The size `defaultItemFor` gives a new item. Each value is an allowed one. */
    defaultSize: z.strictObject({ width: LenSchema, height: LenSchema, depth: LenSchema }),
    defaultElevation: LenSchema,
    options: z.array(OptionDefSchema),
    placement: z.array(z.enum(['wall', 'free'])),
    /** Entries of kind `corner` only. */
    corner: CornerShapeSchema.optional(),
    price: z.strictObject({
      baseCents: z.number().int(),
      perInchWidthCents: z.number().int(),
      /** Added per option value, keyed as `key=value`: `{ 'topDrawer=true': 2500 }`. */
      optionCents: z.record(z.string(), z.number().int()).optional(),
    }),
    /**
     * A retired entry stays in the catalog, so documents that use it keep validating, but it
     * cannot be added to a design or proposed by the assistant.
     */
    retired: z.boolean().optional(),
  })
  .meta({ id: 'CatalogEntry' });

export const FinishSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    target: FinishTargetSchema,
    /** `#rrggbb`. */
    color: z.string(),
    /**
     * What the finish does to the price of an item, in basis points: 10000 leaves it as it
     * is and 11500 adds 15 percent. Defaults to 10000.
     */
    multiplierBps: z.number().int().optional(),
    /** Countertop finishes only: the price of one square foot. */
    pricePerSqftCents: z.number().int().optional(),
    /** Like an entry's: kept so a design that uses it still prices, but no longer offered. */
    retired: z.boolean().optional(),
  })
  .meta({ id: 'Finish' });

export const CatalogSchema = z
  .strictObject({
    version: z.string(),
    entries: z.array(CatalogEntrySchema),
    finishes: z.array(FinishSchema),
  })
  .meta({ id: 'Catalog' });
