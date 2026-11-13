import {
  allowedOptionValues,
  type Catalog,
  type CatalogEntry,
  CatalogSchema,
} from '../catalog/index.js';
import type { ItemKind } from '../document/index.js';
import { issuePath } from '../issues.js';
import { CATEGORY_CATALOG_IDS } from '../photo/draft.js';
import { err, ok, type Result } from '../result.js';
import { DISHWASHER_ID, FRIDGE_ID, HOOD_ID, RANGE_ID, SINK_ID } from '../rules/constants.js';
import { formatLength, type Len, STEP } from '../units/index.js';

// What a Zod schema cannot say about a catalog. Every problem is reported, with the path
// to the field, so a form can show each one next to its input.

export type CatalogProblem = { path: string; message: string };

/**
 * The entries that code looks up by id: the photo import's categories and the rules for
 * appliances and the sink. A catalog without one of them, or with it retired, breaks them.
 */
export const REQUIRED_CATALOG_IDS: readonly string[] = [
  ...new Set([
    ...Object.values(CATEGORY_CATALOG_IDS),
    RANGE_ID,
    HOOD_ID,
    FRIDGE_ID,
    DISHWASHER_ID,
    SINK_ID,
  ]),
].sort();

/** The kinds whose geometry reads each option key (`generateParts`). */
export const OPTION_KINDS: Readonly<Record<string, readonly ItemKind[]>> = {
  drawers: ['base'],
  topDrawer: ['base'],
  doors: ['base', 'wall', 'tall'],
  ovens: ['tall'],
  blind: ['corner'],
};

const COLOR = /^#[0-9a-f]{6}$/i;
const isCents = (value: number): boolean => Number.isInteger(value) && value >= 0;

const dup = <T>(values: readonly T[]): T[] =>
  values.filter((value, index) => values.indexOf(value) !== index);

function widthProblems(entry: CatalogEntry, at: string): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  const { width } = entry;
  const onGrid = (value: Len): boolean => value % STEP === 0;
  const grid = `a multiple of ${formatLength(STEP)}`;
  if ('free' in width) {
    if (entry.kind !== 'filler') bad(`${at}.width`, 'Only fillers may come at any width.');
    const { min, max } = width.free;
    if (min <= 0 || max < min) bad(`${at}.width.free`, 'Use 0 < min <= max.');
  } else if ('values' in width) {
    if (width.values.length === 0) bad(`${at}.width.values`, 'List at least one width.');
    width.values.forEach((value, i) => {
      if (value <= 0 || (!onGrid(value) && entry.kind !== 'panel')) {
        bad(`${at}.width.values.${i}`, `Width ${formatLength(value)} must be ${grid}.`);
      }
    });
    if (dup(width.values).length > 0) bad(`${at}.width.values`, 'Widths must be unique.');
  } else {
    const { min, max, step } = width;
    if (step <= 0 || !onGrid(step)) bad(`${at}.width.step`, `The step must be ${grid}.`);
    if (min <= 0 || !onGrid(min)) bad(`${at}.width.min`, `The least width must be ${grid}.`);
    if (!onGrid(max)) bad(`${at}.width.max`, `The greatest width must be ${grid}.`);
    if (max < min) bad(`${at}.width.max`, 'The greatest width is less than the least.');
    else if (step > 0 && (max - min) % step !== 0) {
      bad(`${at}.width.max`, 'The greatest width is not a whole number of steps above the least.');
    }
  }
  return problems;
}

/** Whether a width is one the rule allows. A filler's range is free. */
function widthAllowed(entry: CatalogEntry, value: Len): boolean {
  const { width } = entry;
  if ('free' in width) return value >= width.free.min && value <= width.free.max;
  if ('values' in width) return width.values.includes(value);
  return (
    value >= width.min &&
    value <= width.max &&
    width.step > 0 &&
    (value - width.min) % width.step === 0
  );
}

function optionProblems(entry: CatalogEntry, at: string): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  for (const key of dup(entry.options.map((option) => option.key))) {
    bad(`${at}.options`, `Option "${key}" appears twice.`);
  }
  entry.options.forEach((def, i) => {
    const o = `${at}.options.${i}`;
    if (def.key === '') bad(`${o}.key`, 'An option needs a key.');
    const kinds = OPTION_KINDS[def.key];
    if (kinds && !kinds.includes(entry.kind)) {
      bad(`${o}.key`, `Option "${def.key}" only works on ${kinds.join(', ')} entries.`);
    }
    if (def.type === 'enum' || (def.type === 'int' && 'values' in def)) {
      if (def.values.length === 0) bad(`${o}.values`, 'List at least one value.');
    }
    if (def.type === 'int' && 'range' in def && def.range.max < def.range.min) {
      bad(`${o}.range`, 'The greatest value is less than the least.');
    }
    if (!allowedOptionValues(def).includes(def.default)) {
      bad(`${o}.default`, `The default ${String(def.default)} is not one of the values.`);
    }
  });
  return problems;
}

function priceProblems(entry: CatalogEntry, at: string): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const { baseCents, perInchWidthCents, optionCents = {} } = entry.price;
  if (!isCents(baseCents)) {
    problems.push({
      path: `${at}.price.baseCents`,
      message: 'Use a whole number of cents, 0 or more.',
    });
  }
  if (!isCents(perInchWidthCents)) {
    problems.push({
      path: `${at}.price.perInchWidthCents`,
      message: 'Use a whole number of cents, 0 or more.',
    });
  }
  for (const [key, cents] of Object.entries(optionCents)) {
    const path = `${at}.price.optionCents.${key}`;
    const split = key.indexOf('=');
    const def = split < 0 ? undefined : entry.options.find((o) => o.key === key.slice(0, split));
    if (!def) {
      problems.push({ path, message: `"${key}" does not name an option of this entry.` });
    } else if (
      !allowedOptionValues(def)
        .map(String)
        .includes(key.slice(split + 1))
    ) {
      problems.push({ path, message: `"${key.slice(split + 1)}" is not a value of ${def.key}.` });
    }
    if (!isCents(cents)) {
      problems.push({ path, message: 'Use a whole number of cents, 0 or more.' });
    }
  }
  return problems;
}

function entryProblems(entry: CatalogEntry, index: number): CatalogProblem[] {
  const at = `entries.${index}`;
  const problems: CatalogProblem[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  if (entry.id.trim() === '') bad(`${at}.id`, 'An entry needs an id.');
  if (entry.name.trim() === '') bad(`${at}.name`, 'An entry needs a name.');

  problems.push(...widthProblems(entry, at));
  for (const key of ['heights', 'depths'] as const) {
    const list = entry[key];
    if (list.length === 0) bad(`${at}.${key}`, 'List at least one size.');
    if (list.some((value) => value <= 0)) bad(`${at}.${key}`, 'Sizes must be greater than zero.');
    if (dup(list).length > 0) bad(`${at}.${key}`, 'Sizes must be unique.');
  }

  const { width, height, depth } = entry.defaultSize;
  if (!widthAllowed(entry, width)) {
    bad(
      `${at}.defaultSize.width`,
      `The default width ${formatLength(width)} is not an allowed width.`,
    );
  }
  if (!entry.heights.includes(height)) {
    bad(
      `${at}.defaultSize.height`,
      `The default height ${formatLength(height)} is not in the heights.`,
    );
  }
  if (!entry.depths.includes(depth)) {
    bad(
      `${at}.defaultSize.depth`,
      `The default depth ${formatLength(depth)} is not in the depths.`,
    );
  }
  if (entry.defaultElevation < 0)
    bad(`${at}.defaultElevation`, 'The elevation cannot be negative.');

  if (entry.placement.length === 0) bad(`${at}.placement`, 'Allow at least one placement.');
  if (dup(entry.placement).length > 0) bad(`${at}.placement`, 'Placements must be unique.');

  if (entry.corner !== undefined && entry.kind !== 'corner') {
    bad(`${at}.corner`, 'Only corner entries have a corner shape.');
  }
  if (entry.corner === 'l' || entry.corner === 'diagonal') {
    if (width !== depth)
      bad(`${at}.defaultSize.depth`, 'An L or diagonal corner is as deep as it is wide.');
    // The depth of one of these is its width, so every width needs a matching depth.
    const widths = 'values' in entry.width ? entry.width.values : [];
    if ('min' in entry.width) {
      for (
        let w = entry.width.min;
        w <= entry.width.max && entry.width.step > 0;
        w += entry.width.step
      ) {
        widths.push(w);
      }
    }
    for (const w of widths) {
      if (!entry.depths.includes(w)) {
        bad(`${at}.depths`, `Width ${formatLength(w)} needs the same depth in the depths.`);
      }
    }
  }

  problems.push(...optionProblems(entry, at), ...priceProblems(entry, at));
  return problems;
}

/** Every rule a catalog must satisfy to be published. An empty list means it is valid. */
export function validateCatalog(catalog: Catalog): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });

  if (catalog.version.trim() === '') bad('version', 'A catalog needs a version.');

  for (const id of dup(catalog.entries.map((entry) => entry.id))) {
    bad('entries', `The entry id "${id}" is used twice.`);
  }
  catalog.entries.forEach((entry, i) => problems.push(...entryProblems(entry, i)));

  for (const id of dup(catalog.finishes.map((finish) => finish.id))) {
    bad('finishes', `The finish id "${id}" is used twice.`);
  }
  catalog.finishes.forEach((finish, i) => {
    const at = `finishes.${i}`;
    if (finish.id.trim() === '') bad(`${at}.id`, 'A finish needs an id.');
    if (finish.name.trim() === '') bad(`${at}.name`, 'A finish needs a name.');
    if (!COLOR.test(finish.color)) bad(`${at}.color`, 'Use a color like #a1b2c3.');
    if (finish.multiplierBps !== undefined && finish.multiplierBps <= 0) {
      bad(`${at}.multiplierBps`, 'The multiplier must be greater than zero.');
    }
    if (finish.pricePerSqftCents !== undefined && !isCents(finish.pricePerSqftCents)) {
      bad(`${at}.pricePerSqftCents`, 'Use a whole number of cents, 0 or more.');
    }
  });

  for (const id of REQUIRED_CATALOG_IDS) {
    const entry = catalog.entries.find((candidate) => candidate.id === id);
    if (!entry) bad('entries', `The entry "${id}" is required by the app and is missing.`);
    else if (entry.retired) {
      bad(
        `entries.${catalog.entries.indexOf(entry)}.retired`,
        `"${id}" is required by the app and cannot be retired.`,
      );
    }
  }
  return problems;
}

/**
 * Unknown JSON to a valid catalog, or every problem with it: the schema's first, then the
 * rules above.
 */
export function parseCatalog(input: unknown): Result<Catalog, CatalogProblem[]> {
  const parsed = CatalogSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    );
  }
  const problems = validateCatalog(parsed.data);
  return problems.length === 0 ? ok(parsed.data) : err(problems);
}
