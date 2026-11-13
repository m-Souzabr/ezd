import { z } from 'zod';

import { parseForgiving } from '../config/parse.js';
import { type Issue, issuePath } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { DEFAULT_SNAP_OPTIONS } from '../snapping/defaults.js';
import { formatLength, IN, type Len } from '../units/index.js';
import {
  DISHWASHER_SINK_DISTANCE,
  FRIDGE_HINGE_CLEARANCE,
  MAX_FILLER_GAP,
  MIN_AISLE,
  MIN_CABINET_GAP,
  RANGE_OVERHEAD_CLEARANCE,
  RECOMMENDED_AISLE,
  WORK_TRIANGLE_MAX,
  WORK_TRIANGLE_MIN,
} from './constants.js';

// The Control Panel's configuration of the design rules: which are on, how serious each is,
// the thresholds they measure against, and the snapping options. Every field is optional
// and its default is what the rules did before this existed (`DEFAULT_RULES_CONFIG`).

export const SeveritySchema = z.enum(['error', 'warning', 'info']);

/** Every rule `validate` runs, with the severity it has unless configured otherwise. */
export const DEFAULT_SEVERITY = {
  'size.width-step': 'error',
  'size.standard': 'error',
  'item.catalog': 'error',
  'item.overlap': 'error',
  'item.outside-wall': 'error',
  'item.outside-room': 'error',
  'item.exceeds-ceiling': 'error',
  'item.blocks-door': 'error',
  'item.blocks-window': 'error',
  'opening.invalid': 'error',
  'corner.conflict': 'error',
  'gap.needs-filler': 'warning',
  'clearance.door-swing': 'warning',
  'clearance.aisle': 'warning',
  'appliance.range-overhead': 'warning',
  'appliance.dishwasher-sink': 'warning',
  'appliance.fridge-door': 'warning',
  'wall.alignment': 'info',
  'countertop.coverage': 'info',
  'room.open': 'info',
  'layout.work-triangle': 'info',
} as const satisfies Record<string, z.infer<typeof SeveritySchema>>;

export type RuleId = keyof typeof DEFAULT_SEVERITY;
export const RULE_IDS = Object.keys(DEFAULT_SEVERITY) as RuleId[];

/**
 * The rules that protect the document's integrity. Turning one off or lowering it would
 * let an invalid design look fine, so each stays on, at error severity. The text says why.
 */
export const LOCKED_RULES: Partial<Record<RuleId, string>> = {
  'item.catalog': 'It keeps every item to what the catalog allows.',
  'item.overlap': 'Two items cannot occupy the same space.',
  'item.outside-wall': 'An item cannot stand past the end of its wall.',
  'item.outside-room': 'An item cannot stand outside the room.',
  'opening.invalid': 'A door or window must fit in its wall.',
  'corner.conflict': 'Two corner cabinets cannot take the same corner.',
  'size.standard': 'Heights and depths are the industry-standard sizes.',
};

export const isLockedRule = (id: string): boolean => Object.hasOwn(LOCKED_RULES, id);

const length = (min: Len, max: Len, fallback: Len) =>
  z
    .number()
    .int('A length is a whole number of sixteenths of an inch.')
    .min(min, `At least ${formatLength(min)}.`)
    .max(max, `At most ${formatLength(max)}.`)
    .default(fallback);

/** Each threshold's range. A value outside it would make its rule do nothing, or everything. */
export const THRESHOLD_RANGES = {
  minCabinetGap: [3 * IN, 24 * IN],
  maxFillerGap: [1 * IN, 12 * IN],
  minAisle: [24 * IN, 72 * IN],
  recommendedAisle: [24 * IN, 96 * IN],
  rangeOverheadClearance: [12 * IN, 60 * IN],
  dishwasherSinkDistance: [12 * IN, 120 * IN],
  fridgeHingeClearance: [1 * IN, 12 * IN],
  workTriangleMin: [60 * IN, 240 * IN],
  workTriangleMax: [120 * IN, 480 * IN],
} as const satisfies Record<string, readonly [Len, Len]>;

export const SNAP_RANGES = {
  grid: [1, 12 * IN],
  wallCaptureDistance: [1 * IN, 48 * IN],
  edgeSnapDistance: [1, 12 * IN],
} as const satisfies Record<string, readonly [Len, Len]>;

const ThresholdsSchema = z
  .strictObject({
    /** The narrowest cabinet: a gap below it needs a filler. */
    minCabinetGap: length(...THRESHOLD_RANGES.minCabinetGap, MIN_CABINET_GAP),
    /** The widest gap one filler closes. */
    maxFillerGap: length(...THRESHOLD_RANGES.maxFillerGap, MAX_FILLER_GAP),
    /** The least room to walk between facing runs or around an island. */
    minAisle: length(...THRESHOLD_RANGES.minAisle, MIN_AISLE),
    recommendedAisle: length(...THRESHOLD_RANGES.recommendedAisle, RECOMMENDED_AISLE),
    /** Clear height above a range under anything but a hood. */
    rangeOverheadClearance: length(
      ...THRESHOLD_RANGES.rangeOverheadClearance,
      RANGE_OVERHEAD_CLEARANCE,
    ),
    /** How near a sink a dishwasher sits. */
    dishwasherSinkDistance: length(
      ...THRESHOLD_RANGES.dishwasherSinkDistance,
      DISHWASHER_SINK_DISTANCE,
    ),
    /** What a refrigerator door needs beside a side wall. */
    fridgeHingeClearance: length(...THRESHOLD_RANGES.fridgeHingeClearance, FRIDGE_HINGE_CLEARANCE),
    /** The least and the most the three legs of the work triangle add up to. */
    workTriangleMin: length(...THRESHOLD_RANGES.workTriangleMin, WORK_TRIANGLE_MIN),
    workTriangleMax: length(...THRESHOLD_RANGES.workTriangleMax, WORK_TRIANGLE_MAX),
  })
  .prefault({})
  .superRefine((value, ctx) => {
    const pairs: [keyof typeof value, keyof typeof value, string][] = [
      ['maxFillerGap', 'minCabinetGap', 'The filler gap cannot exceed the narrowest cabinet.'],
      ['minAisle', 'recommendedAisle', 'The recommended aisle cannot be below the minimum.'],
      ['workTriangleMin', 'workTriangleMax', 'The triangle minimum must be below its maximum.'],
    ];
    for (const [low, high, message] of pairs) {
      const bad = low === 'workTriangleMin' ? value[low] >= value[high] : value[low] > value[high];
      if (bad) ctx.addIssue({ code: 'custom', message, path: [high] });
    }
  });

const SnapSchema = z
  .strictObject({
    /** The grid items snap to along a wall and in the open. */
    grid: length(...SNAP_RANGES.grid, DEFAULT_SNAP_OPTIONS.grid),
    /** How near a wall the pointer must be for the wall to take the item. */
    wallCaptureDistance: length(
      ...SNAP_RANGES.wallCaptureDistance,
      DEFAULT_SNAP_OPTIONS.wallCaptureDistance,
    ),
    /** How near a neighbour, wall end or opening an item must be to go flush against it. */
    edgeSnapDistance: length(
      ...SNAP_RANGES.edgeSnapDistance,
      DEFAULT_SNAP_OPTIONS.edgeSnapDistance,
    ),
    /** In degrees: a divisor of 360 up to 90. */
    freeRotationStep: z
      .number()
      .int()
      .min(1)
      .max(90)
      .refine((step) => 360 % step === 0, 'A divisor of 360, such as 15, 45 or 90.')
      .default(DEFAULT_SNAP_OPTIONS.freeRotationStep),
  })
  .prefault({});

const RuleSettingSchema = (id: RuleId) =>
  z
    .strictObject({
      enabled: z.boolean().default(true),
      severity: SeveritySchema.default(DEFAULT_SEVERITY[id]),
    })
    .prefault({});

export const RulesConfigSchema = z
  .strictObject({
    rules: z
      .strictObject(
        Object.fromEntries(RULE_IDS.map((id) => [id, RuleSettingSchema(id)])) as Record<
          RuleId,
          ReturnType<typeof RuleSettingSchema>
        >,
      )
      .prefault({}),
    thresholds: ThresholdsSchema,
    snap: SnapSchema,
  })
  .prefault({})
  .superRefine((config, ctx) => {
    for (const id of RULE_IDS) {
      if (!isLockedRule(id)) continue;
      const { enabled, severity } = config.rules[id];
      if (!enabled) {
        ctx.addIssue({
          code: 'custom',
          message: `${id} cannot be turned off. ${LOCKED_RULES[id]}`,
          path: ['rules', id, 'enabled'],
        });
      }
      if (severity !== 'error') {
        ctx.addIssue({
          code: 'custom',
          message: `${id} cannot be lowered from error. ${LOCKED_RULES[id]}`,
          path: ['rules', id, 'severity'],
        });
      }
    }
  });

/** The configuration with every default filled in. */
export type RulesConfig = z.output<typeof RulesConfigSchema>;
/** What a caller may give: every field optional. */
export type RulesConfigInput = z.input<typeof RulesConfigSchema>;
export type RuleThresholds = RulesConfig['thresholds'];

export const DEFAULT_RULES_CONFIG: RulesConfig = RulesConfigSchema.parse({});

/** Checks `input` strictly: an unknown key or a bad value is an issue. Fills the defaults. */
export function validateRulesConfig(input: unknown): Result<RulesConfig, Issue[]> {
  const parsed = RulesConfigSchema.safeParse(input ?? {});
  if (parsed.success) return ok(parsed.data);
  return err(
    parsed.error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message })),
  );
}

/**
 * Reads a rules configuration from anywhere, such as the server or a stored copy, and never
 * refuses it: each field that is not valid takes its default, and `ignored` says which.
 */
export const parseRulesConfig = (input: unknown) =>
  parseForgiving(RulesConfigSchema, DEFAULT_RULES_CONFIG, input, 'rules configuration');

/** What each rule checks, in a sentence, for the Control Panel's table. */
export const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  'size.width-step': 'A width off the 3" step or outside the catalog entry’s range.',
  'size.standard': 'A height or depth that is not a standard size for the entry.',
  'item.catalog': 'An item the catalog does not allow: wrong kind, option or placement.',
  'item.overlap': 'Two items that occupy the same space.',
  'item.outside-wall': 'An item that runs past the end of its wall.',
  'item.outside-room': 'A free-standing item that crosses a wall or lies outside the room.',
  'item.exceeds-ceiling': 'An item taller than the ceiling or its wall.',
  'item.blocks-door': 'An item on the same stretch of wall as a door or passage.',
  'item.blocks-window': 'An item in front of a window, above its sill.',
  'opening.invalid': 'A door or window that does not fit its wall or overlaps another.',
  'corner.conflict': 'Items on two walls that overlap in the corner.',
  'gap.needs-filler': 'A gap too narrow for a cabinet, which needs a filler.',
  'clearance.door-swing': 'An item inside the arc a door sweeps as it opens.',
  'clearance.aisle': 'Too little room to walk between runs, an island and a wall.',
  'appliance.range-overhead': 'Anything but a hood too close above a range.',
  'appliance.dishwasher-sink': 'A dishwasher too far from a sink.',
  'appliance.fridge-door': 'A refrigerator too near a side wall for its door to open.',
  'wall.alignment': 'Wall cabinets on one wall whose tops are not level.',
  'countertop.coverage':
    'Base cabinets with no countertop, or a countertop that overhangs too far.',
  'room.open': 'Walls that do not form a closed loop.',
  'layout.work-triangle': 'A work triangle that is too tight or too spread out.',
};

type ThresholdName = keyof RulesConfig['thresholds'];

/** The thresholds each rule measures against, which the table shows on that rule's row. */
export const RULE_THRESHOLDS: Partial<Record<RuleId, readonly ThresholdName[]>> = {
  'gap.needs-filler': ['minCabinetGap', 'maxFillerGap'],
  'clearance.aisle': ['minAisle', 'recommendedAisle'],
  'appliance.range-overhead': ['rangeOverheadClearance'],
  'appliance.dishwasher-sink': ['dishwasherSinkDistance'],
  'appliance.fridge-door': ['fridgeHingeClearance'],
  'layout.work-triangle': ['workTriangleMin', 'workTriangleMax'],
};
