import { z } from 'zod';

import {
  CountertopSchema,
  DocumentNameSchema,
  FinishIdSchema,
  FinishTargetSchema,
  IdSchema,
  ItemSchema,
  NonNegativeLenSchema,
  OpeningKindSchema,
  OpeningSchema,
  OptionValueSchema,
  PlacementSchema,
  PointSchema,
  PositiveLenSchema,
  SwingSchema,
  WallSchema,
} from '../document/index.js';

// Conventions shared by every command:
// - Ids of new entities come from the caller, so replaying a command log is deterministic.
// - `index` is the position to insert at; omitted, the entity goes last.
// - In a patch, an omitted field is left alone. Where a field is optional on the entity,
//   null removes it.

const IndexSchema = z.number().int().nonnegative();

const SetCeilingHeightSchema = z.strictObject({
  type: z.literal('room.setCeilingHeight'),
  height: PositiveLenSchema,
});

const WallAddSchema = z.strictObject({
  type: z.literal('wall.add'),
  wall: WallSchema,
  index: IndexSchema.optional(),
});

const WallUpdateSchema = z.strictObject({
  type: z.literal('wall.update'),
  id: IdSchema,
  patch: z.strictObject({
    start: PointSchema.optional(),
    end: PointSchema.optional(),
    thickness: PositiveLenSchema.optional(),
    height: PositiveLenSchema.nullable().optional(),
  }),
});

/** Removes the wall's openings and countertops too. Fails if any item is placed on the wall. */
const WallRemoveSchema = z.strictObject({ type: z.literal('wall.remove'), id: IdSchema });

const OpeningAddSchema = z.strictObject({
  type: z.literal('opening.add'),
  opening: OpeningSchema,
  index: IndexSchema.optional(),
});

const OpeningUpdateSchema = z.strictObject({
  type: z.literal('opening.update'),
  id: IdSchema,
  patch: z.strictObject({
    wallId: IdSchema.optional(),
    kind: OpeningKindSchema.optional(),
    offset: NonNegativeLenSchema.optional(),
    width: PositiveLenSchema.optional(),
    height: PositiveLenSchema.optional(),
    sillHeight: NonNegativeLenSchema.optional(),
    swing: SwingSchema.nullable().optional(),
  }),
});

const OpeningRemoveSchema = z.strictObject({ type: z.literal('opening.remove'), id: IdSchema });

const ItemAddSchema = z.strictObject({
  type: z.literal('item.add'),
  item: ItemSchema,
  index: IndexSchema.optional(),
});

const ItemMoveSchema = z.strictObject({
  type: z.literal('item.move'),
  id: IdSchema,
  placement: PlacementSchema,
  elevation: NonNegativeLenSchema.optional(),
});

const ItemResizeSchema = z.strictObject({
  type: z.literal('item.resize'),
  id: IdSchema,
  width: PositiveLenSchema.optional(),
  height: PositiveLenSchema.optional(),
  depth: PositiveLenSchema.optional(),
});

/** Shallow merge into the item's options. A null value removes that option. */
const ItemSetOptionsSchema = z.strictObject({
  type: z.literal('item.setOptions'),
  id: IdSchema,
  options: z.record(z.string(), OptionValueSchema.nullable()),
  finishId: z.string().min(1).nullable().optional(),
});

const ItemRemoveSchema = z.strictObject({ type: z.literal('item.remove'), id: IdSchema });

const CountertopAddSchema = z.strictObject({
  type: z.literal('countertop.add'),
  countertop: CountertopSchema,
  index: IndexSchema.optional(),
});

const CountertopUpdateSchema = z.strictObject({
  type: z.literal('countertop.update'),
  id: IdSchema,
  patch: z.strictObject({
    wallId: IdSchema.optional(),
    startOffset: NonNegativeLenSchema.optional(),
    endOffset: PositiveLenSchema.optional(),
    depth: PositiveLenSchema.optional(),
    thickness: PositiveLenSchema.optional(),
    elevation: NonNegativeLenSchema.optional(),
    finishId: FinishIdSchema.nullable().optional(),
  }),
});

const CountertopRemoveSchema = z.strictObject({
  type: z.literal('countertop.remove'),
  id: IdSchema,
});

/** Sets the design-wide finish for a target. A null `finishId` clears it. */
const FinishSetSchema = z.strictObject({
  type: z.literal('finish.set'),
  target: FinishTargetSchema,
  finishId: FinishIdSchema.nullable(),
});

const DocumentRenameSchema = z.strictObject({
  type: z.literal('document.rename'),
  name: DocumentNameSchema,
});

/** Atomic: every command applies, in order, or none does. One undo step. */
const BatchSchema = z.strictObject({
  type: z.literal('batch'),
  get commands() {
    return z.array(CommandSchema);
  },
  label: z.string().optional(),
});

export const CommandSchema = z
  .discriminatedUnion('type', [
    SetCeilingHeightSchema,
    WallAddSchema,
    WallUpdateSchema,
    WallRemoveSchema,
    OpeningAddSchema,
    OpeningUpdateSchema,
    OpeningRemoveSchema,
    ItemAddSchema,
    ItemMoveSchema,
    ItemResizeSchema,
    ItemSetOptionsSchema,
    ItemRemoveSchema,
    CountertopAddSchema,
    CountertopUpdateSchema,
    CountertopRemoveSchema,
    FinishSetSchema,
    DocumentRenameSchema,
    BatchSchema,
  ])
  .meta({ id: 'Command' });

export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];
/** The command with the given `type`. */
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export const COMMAND_TYPES = CommandSchema.options.map(
  (option) => option.shape.type.value,
) as CommandType[];
