import { describe, expect, it } from 'vitest';

import parity from '../../test-vectors/rules-parity.json' with { type: 'json' };
import { SEED_CATALOG } from '../catalog/index.js';
import type { Command } from '../commands/index.js';
import type { DesignDocument } from '../document/index.js';
import { DEFAULT_SNAP_OPTIONS, snap } from '../snapping/index.js';
import { door, free, kitchen, on } from '../test/kitchen.js';
import { defaultItemFor, getEntry } from '../catalog/index.js';
import { parseDocument } from '../document/index.js';
import { inches, IN } from '../units/index.js';
import {
  DEFAULT_RULES_CONFIG,
  DEFAULT_SEVERITY,
  isLockedRule,
  LOCKED_RULES,
  parseRulesConfig,
  RULE_DESCRIPTIONS,
  RULE_IDS,
  RULE_THRESHOLDS,
  RULES,
  type RulesConfig,
  type RulesConfigInput,
  validate,
  validateCommand,
  validateRulesConfig,
} from './index.js';
import * as constants from './constants.js';

const catalog = SEED_CATALOG;
const w = (width: number) => ({ width: inches(width) });

/** A configuration from a partial one, which must be valid. */
function configured(input: RulesConfigInput): RulesConfig {
  const checked = validateRulesConfig(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.error));
  return checked.value;
}

const of = (ruleId: string, doc: DesignDocument, rules?: RulesConfig) =>
  validate(doc, catalog, rules).filter((violation) => violation.ruleId === ruleId);

describe('the defaults', () => {
  it('are today’s constants and snap options', () => {
    expect(DEFAULT_RULES_CONFIG.thresholds).toEqual({
      minCabinetGap: constants.MIN_CABINET_GAP,
      maxFillerGap: constants.MAX_FILLER_GAP,
      minAisle: constants.MIN_AISLE,
      recommendedAisle: constants.RECOMMENDED_AISLE,
      rangeOverheadClearance: constants.RANGE_OVERHEAD_CLEARANCE,
      dishwasherSinkDistance: constants.DISHWASHER_SINK_DISTANCE,
      fridgeHingeClearance: constants.FRIDGE_HINGE_CLEARANCE,
      workTriangleMin: constants.WORK_TRIANGLE_MIN,
      workTriangleMax: constants.WORK_TRIANGLE_MAX,
    });
    expect(DEFAULT_RULES_CONFIG.snap).toEqual(DEFAULT_SNAP_OPTIONS);
  });

  it('list every rule with the severity the rule itself has, all on', () => {
    expect(RULE_IDS).toEqual(RULES.map((rule) => rule.id));
    for (const rule of RULES) {
      expect(DEFAULT_RULES_CONFIG.rules[rule.id as keyof RulesConfig['rules']]).toEqual({
        enabled: true,
        severity: rule.severity,
      });
      expect(DEFAULT_SEVERITY[rule.id as keyof typeof DEFAULT_SEVERITY]).toBe(rule.severity);
    }
  });

  it('give the same violations as no configuration at all', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 32),
      on('base.standard', 'wall-north', 31, w(31)),
      free('base.standard', 40, 54),
      on('appliance.range', 'wall-east', 30),
      on('wall.standard', 'wall-east', 30),
      on('appliance.dishwasher', 'wall-south', 0),
      on('appliance.fridge', 'wall-west', 0),
    ]);
    const plain = validate(doc, catalog);
    expect(plain.length).toBeGreaterThan(5);
    expect(JSON.stringify(validate(doc, catalog, DEFAULT_RULES_CONFIG))).toBe(
      JSON.stringify(plain),
    );
    expect(JSON.stringify(validate(doc, catalog, configured({})))).toBe(JSON.stringify(plain));
  });
});

describe('what the panel shows about each rule', () => {
  it('describes every rule', () => {
    expect(Object.keys(RULE_DESCRIPTIONS).sort()).toEqual([...RULE_IDS].sort());
    for (const text of Object.values(RULE_DESCRIPTIONS)) expect(text.length).toBeGreaterThan(10);
  });

  it('puts every threshold on exactly one rule', () => {
    const listed = Object.values(RULE_THRESHOLDS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(DEFAULT_RULES_CONFIG.thresholds).sort());
    for (const id of Object.keys(RULE_THRESHOLDS)) expect(RULE_IDS).toContain(id);
  });
});

describe('validateRulesConfig', () => {
  it('fills every default for an empty or missing config', () => {
    expect(validateRulesConfig({})).toEqual({ ok: true, value: DEFAULT_RULES_CONFIG });
    expect(validateRulesConfig(undefined)).toEqual({ ok: true, value: DEFAULT_RULES_CONFIG });
  });

  it('keeps what is set and defaults the rest', () => {
    const config = configured({
      rules: { 'clearance.aisle': { severity: 'info' } },
      thresholds: { minAisle: inches(30) },
    });
    expect(config.rules['clearance.aisle']).toEqual({ enabled: true, severity: 'info' });
    expect(config.thresholds.minAisle).toBe(inches(30));
    expect(config.thresholds.recommendedAisle).toBe(constants.RECOMMENDED_AISLE);
  });

  it('refuses an unknown rule, key or severity', () => {
    for (const input of [
      { rules: { 'made.up': { enabled: false } } },
      { thresholds: { minAisles: 1 } },
      { rules: { 'room.open': { severity: 'fatal' } } },
      { extra: true },
    ]) {
      expect(validateRulesConfig(input).ok).toBe(false);
    }
  });

  it.each(Object.keys(LOCKED_RULES))('keeps %s on and at error', (id) => {
    expect(isLockedRule(id)).toBe(true);
    const off = validateRulesConfig({ rules: { [id]: { enabled: false } } });
    expect(off).toMatchObject({
      ok: false,
      error: [
        { path: `rules.${id}.enabled`, message: expect.stringContaining('cannot be turned off') },
      ],
    });
    for (const severity of ['warning', 'info']) {
      const lowered = validateRulesConfig({ rules: { [id]: { severity } } });
      expect(lowered).toMatchObject({
        ok: false,
        error: [
          { path: `rules.${id}.severity`, message: expect.stringContaining('cannot be lowered') },
        ],
      });
    }
    // Saying what it already is stays fine.
    expect(validateRulesConfig({ rules: { [id]: { enabled: true, severity: 'error' } } }).ok).toBe(
      true,
    );
  });

  it('lets the other error rules be turned off or lowered', () => {
    const config = configured({
      rules: {
        'item.blocks-door': { severity: 'warning' },
        'item.exceeds-ceiling': { enabled: false },
      },
    });
    expect(config.rules['item.blocks-door'].severity).toBe('warning');
    expect(config.rules['item.exceeds-ceiling'].enabled).toBe(false);
  });

  it('checks each threshold against its range, at both ends', () => {
    const cases: [keyof RulesConfig['thresholds'], number, number][] = [
      ['minCabinetGap', 3, 24],
      ['maxFillerGap', 1, 12],
      ['minAisle', 24, 72],
      ['recommendedAisle', 24, 96],
      ['rangeOverheadClearance', 12, 60],
      ['dishwasherSinkDistance', 12, 120],
      ['fridgeHingeClearance', 1, 12],
      ['workTriangleMin', 60, 240],
      ['workTriangleMax', 120, 480],
    ];
    for (const [name, min, max] of cases) {
      const set = (value: number) => validateRulesConfig({ thresholds: { [name]: value } });
      // Cross-field limits can still reject an edge of a range, so look at the range message.
      const range = (value: number) => {
        const checked = set(value);
        return checked.ok
          ? undefined
          : checked.error.find(
              (issue) =>
                issue.path === `thresholds.${name}` && /^At (least|most)/.test(issue.message),
            )?.message;
      };
      expect(range(min * IN), name).toBeUndefined();
      expect(range(max * IN), name).toBeUndefined();
      expect(range(min * IN - 1), name).toMatch(/^At least /);
      expect(range(max * IN + 1), name).toMatch(/^At most /);
      expect(set(1.5).ok, name).toBe(false);
    }
  });

  it('keeps the thresholds in order', () => {
    const problem = (thresholds: object) => {
      const checked = validateRulesConfig({ thresholds });
      return checked.ok ? undefined : checked.error;
    };
    expect(problem({ minAisle: inches(48) })).toEqual([
      {
        path: 'thresholds.recommendedAisle',
        message: 'The recommended aisle cannot be below the minimum.',
      },
    ]);
    expect(problem({ minAisle: inches(48), recommendedAisle: inches(48) })).toBeUndefined();
    expect(problem({ minCabinetGap: inches(5) })).toEqual([
      {
        path: 'thresholds.minCabinetGap',
        message: 'The filler gap cannot exceed the narrowest cabinet.',
      },
    ]);
    expect(problem({ workTriangleMin: inches(160), workTriangleMax: inches(160) })).toEqual([
      {
        path: 'thresholds.workTriangleMax',
        message: 'The triangle minimum must be below its maximum.',
      },
    ]);
  });

  it('checks the snap options', () => {
    const bad = (snapOptions: object) => validateRulesConfig({ snap: snapOptions }).ok;
    expect(bad({ grid: 0 })).toBe(false);
    expect(bad({ grid: 12 * IN + 1 })).toBe(false);
    expect(bad({ grid: 1 })).toBe(true);
    expect(bad({ wallCaptureDistance: 0 })).toBe(false);
    expect(bad({ edgeSnapDistance: 0 })).toBe(false);
    expect(bad({ edgeSnapDistance: 12 * IN })).toBe(true);
    expect(bad({ freeRotationStep: 7 })).toBe(false);
    expect(bad({ freeRotationStep: 180 })).toBe(false);
    expect(bad({ freeRotationStep: 45 })).toBe(true);
  });
});

describe('parseRulesConfig', () => {
  it('reads a good config as it is', () => {
    const parsed = parseRulesConfig({ thresholds: { minAisle: inches(30) } });
    expect(parsed).toMatchObject({ ok: true, value: { ignored: [] } });
  });

  it('drops a bad value to its default and says so, without refusing the rest', () => {
    const parsed = parseRulesConfig({
      rules: { 'room.open': { severity: 'warning' }, 'item.overlap': { enabled: false } },
      thresholds: { minAisle: 1, rangeOverheadClearance: inches(24) },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { config, ignored } = parsed.value;
    expect(config.rules['room.open'].severity).toBe('warning');
    expect(config.rules['item.overlap'].enabled).toBe(true);
    expect(config.thresholds.minAisle).toBe(constants.MIN_AISLE);
    expect(config.thresholds.rangeOverheadClearance).toBe(inches(24));
    expect(ignored.map((issue) => issue.path).sort()).toEqual([
      'rules.item.overlap.enabled',
      'thresholds.minAisle',
    ]);
  });

  it('drops the field a cross-check points at, and keeps the other', () => {
    // Both are in range, but the minimum is above the maximum.
    const parsed = parseRulesConfig({
      thresholds: { workTriangleMin: inches(240), workTriangleMax: inches(120) },
    });
    expect(parsed.ok && parsed.value.config.thresholds).toEqual({
      ...DEFAULT_RULES_CONFIG.thresholds,
      workTriangleMin: inches(240),
    });
  });

  it('starts a section again when dropping a field does not make it valid', () => {
    const parsed = parseRulesConfig({
      thresholds: { minAisle: inches(72), recommendedAisle: inches(24), workTriangleMax: 'x' },
    });
    expect(parsed.ok && parsed.value.config.thresholds).toEqual(DEFAULT_RULES_CONFIG.thresholds);
  });

  it('refuses a value that is not an object', () => {
    expect(parseRulesConfig([])).toEqual({
      ok: false,
      error: { path: '', message: 'The rules configuration must be an object.' },
    });
  });
});

describe('severity and switches', () => {
  const overlapping = kitchen([
    on('base.standard', 'wall-north', 0),
    on('base.standard', 'wall-north', 36),
    on('wall.standard', 'wall-north', 0),
    on('wall.standard', 'wall-north', 36, { elevation: inches(60) }),
  ]);

  it('reports a rule at its configured severity', () => {
    const rules = configured({ rules: { 'wall.alignment': { severity: 'error' } } });
    expect(of('wall.alignment', overlapping)[0]?.severity).toBe('info');
    expect(of('wall.alignment', overlapping, rules)[0]?.severity).toBe('error');
  });

  it('sorts by the configured severity', () => {
    const rules = configured({
      rules: { 'wall.alignment': { severity: 'error' }, 'clearance.aisle': { severity: 'info' } },
    });
    const found = validate(overlapping, catalog, rules);
    expect(found.map((violation) => violation.severity)).toEqual(
      [...found.map((violation) => violation.severity)].sort(
        (a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b),
      ),
    );
  });

  it('reports nothing from a rule that is off', () => {
    const rules = configured({ rules: { 'wall.alignment': { enabled: false } } });
    expect(of('wall.alignment', overlapping)).toHaveLength(1);
    expect(of('wall.alignment', overlapping, rules)).toEqual([]);
  });

  it('ignores a locked rule that an unchecked config turns off or lowers', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 12),
    ]);
    const tampered = JSON.parse(JSON.stringify(DEFAULT_RULES_CONFIG)) as RulesConfig;
    tampered.rules['item.overlap'] = { enabled: false, severity: 'info' };
    expect(of('item.overlap', doc, tampered)).toEqual(of('item.overlap', doc));
    expect(of('item.overlap', doc, tampered)[0]?.severity).toBe('error');
  });

  it('makes validateCommand call a configured error what it is', () => {
    const rules = configured({ rules: { 'clearance.aisle': { severity: 'error' } } });
    const doc = kitchen([on('base.standard', 'wall-north', 40)]);
    const add: Command = {
      type: 'item.add',
      item: defaultItemFor(getEntry(catalog, 'base.standard')!, 'item-island', {
        type: 'free',
        x: inches(40),
        y: inches(54),
        rotation: 0,
      }),
    };
    const result = validateCommand(doc, catalog, add, rules);
    expect(result.ok && result.value.introduced.map((v) => [v.ruleId, v.severity])).toEqual([
      ['clearance.aisle', 'error'],
    ]);
    const off = configured({ rules: { 'clearance.aisle': { enabled: false } } });
    const quiet = validateCommand(doc, catalog, add, off);
    expect(quiet.ok && quiet.value.introduced).toEqual([]);
  });
});

describe('each threshold changes the outcome at its boundary', () => {
  const at = (name: keyof RulesConfig['thresholds'], value: number, extra: RulesConfigInput = {}) =>
    configured({ ...extra, thresholds: { ...extra.thresholds, [name]: inches(value) } });

  it('minAisle: an aisle of 30 in', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 40), free('base.standard', 40, 54)]);
    expect(of('clearance.aisle', doc, at('minAisle', 30))).toEqual([]);
    const [violation] = of('clearance.aisle', doc, at('minAisle', 31));
    expect(violation?.message).toContain('An aisle needs at least 31"; 42" is recommended.');
  });

  it('recommendedAisle is quoted in the message', () => {
    const doc = kitchen([on('base.standard', 'wall-north', 40), free('base.standard', 40, 54)]);
    expect(of('clearance.aisle', doc, at('recommendedAisle', 50))[0]?.message).toContain(
      '50" is recommended',
    );
  });

  it('minCabinetGap: a gap of 3 in', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 33),
    ]);
    expect(of('gap.needs-filler', doc)).toHaveLength(1);
    const small = (value: number) =>
      at('minCabinetGap', value, { thresholds: { maxFillerGap: inches(3) } });
    expect(of('gap.needs-filler', doc, small(3))).toEqual([]);
    const wide = of('gap.needs-filler', doc, at('minCabinetGap', 12));
    expect(wide).toHaveLength(1);
    const far = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 40),
    ]);
    expect(of('gap.needs-filler', far)).toEqual([]);
    expect(of('gap.needs-filler', far, at('minCabinetGap', 12))[0]?.message).toContain(
      'widen it to at least 12"',
    );
  });

  it('maxFillerGap: a gap of 6 in gets a filler only up to the limit', () => {
    const doc = kitchen([
      on('base.standard', 'wall-north', 0),
      on('base.standard', 'wall-north', 36),
    ]);
    expect(of('gap.needs-filler', doc)[0]?.fix).toHaveLength(1);
    const noFix = of('gap.needs-filler', doc, at('maxFillerGap', 5))[0];
    expect(noFix?.fix).toBeUndefined();
    expect(noFix?.message).toContain('Close the gap');
  });

  it('rangeOverheadClearance: a cabinet 18 in above a range', () => {
    const doc = kitchen([
      on('appliance.range', 'wall-north', 30),
      on('wall.standard', 'wall-north', 30),
    ]);
    expect(of('appliance.range-overhead', doc)).toHaveLength(1);
    expect(of('appliance.range-overhead', doc, at('rangeOverheadClearance', 18))).toEqual([]);
    expect(
      of('appliance.range-overhead', doc, at('rangeOverheadClearance', 19))[0]?.message,
    ).toContain('Leave at least 19"');
  });

  it('dishwasherSinkDistance: a sink 48 in away', () => {
    const doc = kitchen([
      on('appliance.dishwasher', 'wall-north', 0),
      on('base.sink', 'wall-north', 72),
    ]);
    expect(of('appliance.dishwasher-sink', doc)).toHaveLength(1);
    expect(of('appliance.dishwasher-sink', doc, at('dishwasherSinkDistance', 48))).toEqual([]);
    expect(
      of('appliance.dishwasher-sink', doc, at('dishwasherSinkDistance', 47))[0]?.message,
    ).toContain('within 47"');
  });

  it('fridgeHingeClearance: a refrigerator 2 in from the side wall', () => {
    const doc = kitchen([on('appliance.fridge', 'wall-north', 106)]);
    expect(of('appliance.fridge-door', doc)).toHaveLength(1);
    expect(of('appliance.fridge-door', doc, at('fridgeHingeClearance', 2))).toEqual([]);
    expect(of('appliance.fridge-door', doc, at('fridgeHingeClearance', 4))[0]?.message).toContain(
      'at least 4"',
    );
  });

  it('workTriangleMin and workTriangleMax', () => {
    const tight = kitchen([
      on('base.sink', 'wall-north', 0),
      on('appliance.range', 'wall-north', 36),
      on('appliance.fridge', 'wall-north', 66),
    ]);
    // The triangle is 132 1/8 in around.
    expect(of('layout.work-triangle', tight)).toHaveLength(1);
    expect(of('layout.work-triangle', tight, at('workTriangleMin', 132))).toEqual([]);
    expect(of('layout.work-triangle', tight, at('workTriangleMin', 133))[0]?.message).toContain(
      'recommended 133" to 312"',
    );
    const spread = kitchen([
      on('base.sink', 'wall-north', 0),
      on('appliance.range', 'wall-east', 90),
      on('appliance.fridge', 'wall-west', 0),
    ]);
    expect(of('layout.work-triangle', spread)).toHaveLength(1);
    expect(of('layout.work-triangle', spread, at('workTriangleMax', 480))).toEqual([]);
    expect(of('layout.work-triangle', spread, at('workTriangleMax', 200))[0]?.message).toContain(
      'to 200"',
    );
  });
});

describe('snap options from the configuration', () => {
  const doc = kitchen();
  const item = defaultItemFor(getEntry(catalog, 'base.standard')!, 'item-new-0001');
  // The pointer is 71 in along the wall, so the item's left edge is at 56 in.
  const pointer = { x: inches(71), y: inches(5) };
  const offsetOf = (rules?: RulesConfig, options?: object) => {
    const { placement } = snap({ doc, catalog, item, pointer, rules, options });
    return placement.type === 'wall' ? placement.offset : placement;
  };

  it('uses the configured grid, and the default without one', () => {
    expect(offsetOf()).toBe(inches(57));
    expect(offsetOf(configured({ snap: { grid: inches(5) } }))).toBe(inches(55));
    expect(offsetOf(configured({ snap: { grid: inches(1) } }))).toBe(inches(56));
  });

  it('lets an explicit option win over the configuration', () => {
    expect(offsetOf(configured({ snap: { grid: inches(5) } }), { grid: inches(6) })).toBe(
      inches(54),
    );
  });

  it('uses the configured wall capture distance', () => {
    const away = { x: inches(70), y: inches(30) };
    const place = (rules?: RulesConfig) =>
      snap({
        doc,
        catalog,
        item: { ...item, placement: { type: 'free', x: 0, y: 0, rotation: 0 } },
        pointer: away,
        rules,
      }).placement.type;
    expect(place()).toBe('free');
    expect(place(configured({ snap: { wallCaptureDistance: inches(48) } }))).toBe('wall');
  });

  it('uses the configured edge snap distance and rotation step', () => {
    const neighbours = kitchen([on('base.standard', 'wall-north', 30)]);
    const near = { x: inches(30 + 30 + 15 + 3), y: inches(5) };
    const flush = (rules?: RulesConfig) => {
      const { placement } = snap({ doc: neighbours, catalog, item, pointer: near, rules });
      return placement.type === 'wall' ? placement.offset : -1;
    };
    expect(flush()).toBe(inches(63));
    expect(flush(configured({ snap: { edgeSnapDistance: inches(4) } }))).toBe(inches(60));

    const spun = { ...item, placement: { type: 'free', x: 0, y: 0, rotation: 50 } } as const;
    const rotation = (rules?: RulesConfig) => {
      const { placement } = snap({
        doc,
        catalog,
        item: spun,
        pointer: { x: inches(60), y: inches(60) },
        rules,
      });
      return placement.type === 'free' ? placement.rotation : -1;
    };
    expect(rotation()).toBe(90);
    expect(rotation(configured({ snap: { freeRotationStep: 45 } }))).toBe(45);
  });

  it('judges what a drop introduces by the configured rules', () => {
    const wallDoc = kitchen([], { openings: [door('wall-north', 30, 36)] });
    const result = (rules?: RulesConfig) =>
      snap({ doc: wallDoc, catalog, item, pointer: { x: inches(48), y: inches(5) }, rules });
    expect(result().introduced.map((violation) => violation.ruleId)).toContain('item.blocks-door');
    const quiet = configured({ rules: { 'item.blocks-door': { enabled: false } } });
    expect(result(quiet).introduced.map((violation) => violation.ruleId)).not.toContain(
      'item.blocks-door',
    );
  });
});

describe('the shared parity fixture', () => {
  // The CLI, the browser store and the API's tests read the same file, so a change to how a
  // configuration is read shows up in all of them at once.
  const document = parseDocument(parity.document);
  const rules = validateRulesConfig(parity.rules);

  it('gives the violations the file records, with and without its configuration', () => {
    expect(document.ok && rules.ok).toBe(true);
    if (!document.ok || !rules.ok) return;
    expect(validate(document.value, catalog, rules.value)).toEqual(parity.expected);
    expect(validate(document.value, catalog)).toEqual(parity.expectedDefaults);
    expect(parity.expected).not.toEqual(parity.expectedDefaults);
  });
});
