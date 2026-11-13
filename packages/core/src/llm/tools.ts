import { z } from 'zod';

import {
  activeEntries,
  allowedOptionValues,
  allowedWidths,
  type Catalog,
  type CatalogEntry,
  FILLER_MIN_WIDTH,
  type OptionDef,
} from '../catalog/index.js';
import { FinishTargetSchema, OpeningKindSchema, SwingSchema } from '../document/index.js';
import type { JsonSchema } from '../schema/index.js';
import { IN, STEP, toInches } from '../units/index.js';

// The tools the model may call. Every length is in inches, as a decimal number exact to
// 1/16 in. Two sets of schemas describe the same tools:
// - `llmToolSchemas(catalog)`, exported as JSON Schema for the vendor and the server,
//   spells out every rule a schema can: catalog ids, widths, heights, depths and options
//   for each entry. It is what keeps the model on the 3 in grid.
// - `ToolArgsSchemas` checks structure only, so `proposalToCommands` can answer a size or
//   catalog mistake with core's own message, which says what to use instead.

/** One tool call as the vendor returns it, after the server has parsed its arguments. */
export type ToolCall = { name: string; arguments: unknown };

/** A length in inches, exact to 1/16 in. */
const Inches = z.number().multipleOf(1 / IN);
const NonNegativeInches = Inches.nonnegative();
const PositiveInches = Inches.positive();

const WallLabel = z
  .string()
  .regex(/^[A-Z]{1,2}$/)
  .describe('Wall label from the design summary: A, B, C and so on.')
  .meta({ id: 'WallLabel' });
const ItemAlias = z
  .string()
  .regex(/^c\d+$/)
  .describe('Item alias from the design summary: c1, c2 and so on.');
const OpeningAlias = z
  .string()
  .regex(/^o\d+$/)
  .describe('Opening alias from the design summary: o1, o2 and so on.');

const FreePlacement = z
  .strictObject({
    xIn: Inches.describe('Back left corner, plan x.'),
    yIn: Inches.describe('Back left corner, plan y (y grows into the room from wall A).'),
    rotation: z.int().min(0).max(359).describe('Degrees, clockwise seen from above.'),
  })
  .describe('Free-standing placement, for islands. Give either wall and offsetIn, or free.')
  .meta({ id: 'FreePlacement' });

const placementFields = {
  wall: WallLabel.optional(),
  offsetIn: NonNegativeInches.describe(
    'Left edge of the item, from the start of the wall, along it.',
  )
    .meta({ id: 'ItemOffset' })
    .optional(),
  free: FreePlacement.optional(),
  elevationIn: NonNegativeInches.describe(
    'Bottom of the item above the floor. Leave it out for the catalog default.',
  )
    .meta({ id: 'Elevation' })
    .optional(),
};

const OptionValue = z.union([z.string(), z.number(), z.boolean()]);

const openingFields = {
  offsetIn: NonNegativeInches.describe('Left edge, from the start of the wall.'),
  widthIn: PositiveInches,
  heightIn: PositiveInches,
  sillIn: NonNegativeInches.optional().describe('Windows only: the sill above the floor.'),
  swing: SwingSchema.optional().describe('Doors only.'),
};

/** Structure only. Sizes, catalog ids and options are checked by core against the catalog. */
export const ToolArgsSchemas = {
  add_item: z.strictObject({
    catalogId: z.string().min(1),
    widthIn: PositiveInches,
    heightIn: PositiveInches.optional(),
    depthIn: PositiveInches.optional(),
    ...placementFields,
    options: z.record(z.string(), OptionValue).optional(),
  }),
  move_item: z.strictObject({ item: ItemAlias, ...placementFields }),
  resize_item: z.strictObject({
    item: ItemAlias,
    widthIn: PositiveInches.optional(),
    heightIn: PositiveInches.optional(),
    depthIn: PositiveInches.optional(),
  }),
  set_item_options: z.strictObject({
    item: ItemAlias,
    options: z.record(z.string(), OptionValue).optional(),
    finishId: z.string().min(1).optional(),
  }),
  remove_item: z.strictObject({ item: ItemAlias }),
  add_opening: z.strictObject({ wall: WallLabel, kind: OpeningKindSchema, ...openingFields }),
  update_opening: z.strictObject({
    opening: OpeningAlias,
    wall: WallLabel.optional(),
    kind: OpeningKindSchema.optional(),
    offsetIn: openingFields.offsetIn.optional(),
    widthIn: PositiveInches.optional(),
    heightIn: PositiveInches.optional(),
    sillIn: openingFields.sillIn,
    swing: openingFields.swing,
  }),
  remove_opening: z.strictObject({ opening: OpeningAlias }),
  set_finish: z.strictObject({ target: FinishTargetSchema, finishId: z.string().min(1) }),
  generate_countertops: z.strictObject({}),
  ask_user: z.strictObject({ question: z.string().min(1).max(500) }),
};

export type ToolName = keyof typeof ToolArgsSchemas;
export const TOOL_NAMES = Object.keys(ToolArgsSchemas) as ToolName[];
export type ToolArgs<T extends ToolName> = z.infer<(typeof ToolArgsSchemas)[T]>;

const SIZE_RULES =
  'Sizes follow the catalog: cabinet widths are multiples of 3 in within the range of the ' +
  'entry, heights and depths are one of the standard values listed for the entry, and only ' +
  'fillers take an arbitrary width. Never round a size the user asked for to something ' +
  'else without saying so; if it is not allowed, ask with ask_user.';

const DESCRIPTIONS: Record<ToolName, string> = {
  add_item:
    'Add a catalog item. Put it on a wall (wall and offsetIn) or free-standing (free). ' +
    'Heights, depths, elevation and options default to the catalog entry. ' +
    SIZE_RULES,
  move_item:
    'Move an item to another position on a wall (wall and offsetIn) or free-standing ' +
    '(free), optionally at another elevation.',
  resize_item: `Change the width, height or depth of an item. ${SIZE_RULES}`,
  set_item_options:
    "Change an item's options (only the keys given change) or its own finish (a cabinet " +
    'finish id).',
  remove_item: 'Remove an item.',
  add_opening:
    'Add a door, window or passage to a wall. Doors and passages have no sill; windows ' +
    'need sillIn.',
  update_opening: 'Change an opening. Only the fields given change.',
  remove_opening: 'Remove an opening.',
  set_finish: 'Set the design-wide finish for cabinets, countertops, walls or the floor.',
  generate_countertops:
    'Add countertops over every run of base cabinets that has none. Call it after the ' +
    'cabinets it should cover.',
  ask_user:
    'Ask the user a clarifying question instead of changing the design. Use it when the ' +
    'request is ambiguous, impossible, or asks for a size the catalog does not allow. ' +
    'Call no other tool in the same turn.',
};

// --- the catalog-specific schemas ------------------------------------------------------

const inchesList = (values: readonly number[]): number[] => values.map(toInches);

function literalOf<T extends string | number>(values: readonly T[]) {
  return values.length === 1 ? z.literal(values[0]!) : z.literal([...values] as [T, ...T[]]);
}

function widthSchema(entry: CatalogEntry) {
  const { width } = entry;
  if ('values' in width) return literalOf(inchesList(width.values));
  if ('free' in width) {
    return Inches.min(toInches(width.free.min)).max(toInches(width.free.max));
  }
  return z
    .number()
    .multipleOf(toInches(width.step))
    .min(toInches(width.min))
    .max(toInches(width.max));
}

function optionSchema(def: OptionDef) {
  if (def.type === 'bool') return z.boolean();
  if (def.type === 'enum') return z.enum(def.values as [string, ...string[]]);
  if ('values' in def) return literalOf(def.values);
  return z.int().min(def.range.min).max(def.range.max);
}

const describeOption = (def: OptionDef): string =>
  `${def.key}: ${allowedOptionValues(def).map(String).join(' | ')}, default ${String(def.default)}`;

function addItemVariant(entry: CatalogEntry) {
  const options = Object.fromEntries(
    entry.options.map((def) => [def.key, optionSchema(def).optional()]),
  );
  return z
    .strictObject({
      catalogId: z.literal(entry.id),
      widthIn: widthSchema(entry),
      heightIn: literalOf(inchesList(entry.heights)).optional(),
      depthIn: literalOf(inchesList(entry.depths)).optional(),
      ...placementFields,
      ...(entry.options.length > 0 && {
        options: z
          .strictObject(options)
          .optional()
          .describe(entry.options.map(describeOption).join('; ')),
      }),
    })
    .describe(entry.name);
}

/**
 * The tool schemas for a catalog, with every rule a schema can state. `add_item` is one
 * variant per catalog entry, chosen by `catalogId`.
 */
export function llmToolSchemas(catalog: Catalog): Record<ToolName, z.ZodType> {
  const [first, ...rest] = activeEntries(catalog).map(addItemVariant);
  const finishIds = catalog.finishes.map((finish) => finish.id);
  const cabinetFinishIds = catalog.finishes
    .filter((finish) => finish.target === 'cabinet')
    .map((finish) => finish.id);
  const widest = Math.max(...catalog.entries.flatMap((entry) => allowedWidths(entry).slice(-1)));
  const anyWidth = Inches.min(toInches(FILLER_MIN_WIDTH)).max(toInches(widest));
  return {
    ...ToolArgsSchemas,
    add_item: rest.length === 0 ? first! : z.discriminatedUnion('catalogId', [first!, ...rest]),
    resize_item: ToolArgsSchemas.resize_item.extend({
      widthIn: anyWidth
        .optional()
        .describe(
          `A multiple of ${toInches(STEP)} in for cabinets and appliances; fillers only may take any width.`,
        ),
    }),
    set_item_options: ToolArgsSchemas.set_item_options.extend({
      finishId: (cabinetFinishIds.length > 0 ? z.enum(cabinetFinishIds) : z.string())
        .optional()
        .describe('A cabinet finish id.'),
    }),
    set_finish: ToolArgsSchemas.set_finish.extend({
      finishId: z.enum(finishIds as [string, ...string[]]),
    }),
  };
}

export type LlmToolDefinition = { name: ToolName; description: string; parameters: JsonSchema };

/**
 * The tools as JSON Schema, in a fixed order, for the vendor's tool definitions and for the
 * server's check of each call. Every `parameters` is an object schema at its root.
 */
export function llmToolDefinitions(catalog: Catalog): LlmToolDefinition[] {
  const schemas = llmToolSchemas(catalog);
  return TOOL_NAMES.map((name) => {
    const schema = z.toJSONSchema(schemas[name]) as JsonSchema;
    delete schema.$schema;
    return {
      name,
      description: DESCRIPTIONS[name],
      parameters: { type: 'object', ...schema },
    };
  });
}
