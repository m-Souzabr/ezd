import { z } from 'zod';

import { ItemKindSchema } from '../document/schema.js';
import { IN, STEP } from '../units/index.js';

// The Control Panel's configuration of the app. Every field is optional on input and has a
// compiled-in default, which is what the app did before any configuration existed.

const Flag = (value: boolean) => z.boolean().default(value);

/** `#rrggbb`, or `#rrggbbaa` for a fill that lets what is behind it show through. */
export const ColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a color such as #1a2b3c.');

const section = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).prefault({} as never);

const Text = (max: number) => z.string().trim().min(1).max(max);

export const ITEM_KINDS = ItemKindSchema.options;
type Kind = (typeof ITEM_KINDS)[number];

const GROUP_TITLES: Record<Kind, string> = {
  base: 'Base cabinets',
  wall: 'Wall cabinets',
  tall: 'Tall cabinets',
  corner: 'Corner cabinets',
  appliance: 'Appliances',
  filler: 'Fillers',
  panel: 'Panels',
};

const ITEM_FILLS: Record<Kind, string> = {
  base: '#dbeafe',
  wall: '#fef08a8c',
  tall: '#dcfce7',
  corner: '#e0e7ff',
  appliance: '#e2e8f0',
  filler: '#f1f5f9',
  panel: '#f1f5f9',
};

const PLAN_COLORS = {
  gridMinor: '#eef2f6',
  gridMajor: '#dbe2ea',
  floor: '#faf8f4',
  wall: '#475569',
  opening: '#ffffff',
  openingLine: '#64748b',
  countertopLine: '#94a3b8',
  itemLine: '#334155',
  label: '#0f172a',
  dimension: '#64748b',
  selection: '#0284c7',
  guide: '#c026d3',
  error: '#dc2626',
  warning: '#d97706',
} as const;

export const HELP_STEPS: { title: string; text: string }[] = [
  {
    title: 'Make the room',
    text: 'Room template makes a rectangle, L or U room from its inside dimensions. Or pick the Wall tool and click each corner; double-click to finish.',
  },
  {
    title: 'Add doors and windows',
    text: 'Pick the Opening tool, choose Door or Window, and click a wall. Change sizes and offsets in the properties on the right.',
  },
  {
    title: 'Place cabinets and appliances',
    text: 'Drag them from the catalog onto a wall; they snap to the wall and to their neighbours. Or select the canvas and use Add, then the arrow keys.',
  },
  {
    title: 'Fix what the checks find',
    text: 'The validation panel lists overlaps, blocked doors, gaps and clearances. Click one to see it; Apply fixes those that have a fix.',
  },
  {
    title: 'Finish and price it',
    text: 'Generate countertops, open Materials for the bill of materials, and create a quote from Quotes.',
  },
];

const kindRecord = <T extends z.ZodType>(make: (kind: Kind) => T) =>
  z
    .strictObject(
      Object.fromEntries(ITEM_KINDS.map((kind) => [kind, make(kind)])) as Record<Kind, T>,
    )
    .prefault({} as never);

const CatalogPanelSchema = section({
  visible: Flag(true),
  /** The order the groups are listed in: every kind exactly once. */
  order: z
    .array(ItemKindSchema)
    .default([...ITEM_KINDS])
    .refine((order) => new Set(order).size === ITEM_KINDS.length, {
      message: 'List every kind of item exactly once.',
    }),
  groups: kindRecord((kind) =>
    z
      .strictObject({ title: Text(40).default(GROUP_TITLES[kind]), visible: Flag(true) })
      .prefault({}),
  ),
});

const PanelsSchema = section({
  properties: section({ visible: Flag(true), defaultCollapsed: Flag(false) }),
  validation: section({ visible: Flag(true) }),
  materials: section({ visible: Flag(true) }),
  catalog: CatalogPanelSchema,
});

const FeaturesSchema = section({
  assistant: Flag(true),
  photoImport: Flag(true),
  quotes: Flag(true),
  versions: Flag(true),
  roomTemplates: Flag(true),
  jsonImportExport: Flag(true),
  localEditor: Flag(true),
  registrationOpen: Flag(true),
});

const ToolbarSchema = z
  .strictObject({
    tools: section({ select: Flag(true), wall: Flag(true), opening: Flag(true), pan: Flag(true) }),
    buttons: section({
      undoRedo: Flag(true),
      views: Flag(true),
      fit: Flag(true),
      countertops: Flag(true),
      help: Flag(true),
    }),
  })
  .prefault({})
  .refine((toolbar) => toolbar.tools.select, {
    message: 'The Select tool cannot be hidden: it is the editor’s default tool.',
    path: ['tools', 'select'],
  });

const scale = z.number().positive().max(200);

const ViewportSchema = z
  .strictObject({
    defaultScale: scale.default(4),
    /** The fine grid, as a length. It must not be coarser than the 12 in grid. */
    gridStep: z
      .number()
      .int()
      .min(1)
      .max(12 * IN)
      .default(STEP),
    minScale: scale.default(0.5),
    maxScale: scale.default(40),
  })
  .prefault({})
  .refine((v) => v.minScale <= v.defaultScale && v.defaultScale <= v.maxScale, {
    message: 'The default scale must lie between the minimum and the maximum.',
    path: ['defaultScale'],
  });

const ThemeSchema = section({
  plan: z
    .strictObject(
      Object.fromEntries(
        Object.entries(PLAN_COLORS).map(([name, color]) => [name, ColorSchema.default(color)]),
      ) as Record<keyof typeof PLAN_COLORS, z.ZodDefault<typeof ColorSchema>>,
    )
    .prefault({}),
  itemFill: kindRecord((kind) => ColorSchema.default(ITEM_FILLS[kind])),
});

const HelpSchema = section({
  steps: z
    .array(z.strictObject({ title: Text(60), text: Text(400) }))
    .min(1)
    .max(10)
    .default(HELP_STEPS),
});

export const AppConfigSchema = z
  .strictObject({
    panels: PanelsSchema,
    features: FeaturesSchema,
    toolbar: ToolbarSchema,
    viewport: ViewportSchema,
    theme: ThemeSchema,
    help: HelpSchema,
  })
  .prefault({});

/** The configuration with every default filled in. */
export type AppConfig = z.output<typeof AppConfigSchema>;
/** What a caller may give: every field optional. */
export type AppConfigInput = z.input<typeof AppConfigSchema>;
