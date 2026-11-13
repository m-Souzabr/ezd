import type { Item, OptionValue } from '../document/index.js';
import { formatLength, type Len, STEP } from '../units/index.js';
import {
  activeEntries,
  allowedWidths,
  type Catalog,
  type CatalogEntry,
  getEntry,
  type OptionDef,
} from './types.js';

export type ConstraintCode =
  | 'UNKNOWN_CATALOG_ID'
  | 'ENTRY_RETIRED'
  | 'KIND_MISMATCH'
  | 'WIDTH_OFF_STEP'
  | 'WIDTH_OUT_OF_RANGE'
  | 'HEIGHT_NOT_STANDARD'
  | 'DEPTH_NOT_STANDARD'
  | 'OPTION_INVALID'
  | 'PLACEMENT_NOT_ALLOWED';

export type ConstraintError = {
  code: ConstraintCode;
  /** Says what is wrong and what to use instead. */
  message: string;
  /** The values that would pass, so a UI or the LLM can correct itself. Lengths are `Len`. */
  allowed: OptionValue[];
  /** For `OPTION_INVALID`, the option key. */
  option?: string;
};

const isFree = (entry: CatalogEntry): boolean => 'free' in entry.width;

const listed = (values: readonly string[]): string =>
  values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]!}`;
const lengths = (values: readonly Len[]): string => listed(values.map(formatLength));

function describeWidths(entry: CatalogEntry): string {
  const { width } = entry;
  if ('free' in width) {
    return `any width from ${formatLength(width.free.min)} to ${formatLength(width.free.max)}`;
  }
  if ('values' in width) return lengths(allowedWidths(entry));
  const { min, max, step } = width;
  return `a multiple of ${formatLength(step)} from ${formatLength(min)} to ${formatLength(max)}`;
}

/** The values an option accepts. */
export function allowedOptionValues(def: OptionDef): OptionValue[] {
  if (def.type === 'bool') return [true, false];
  if ('values' in def) return [...def.values];
  const values: number[] = [];
  for (let n = def.range.min; n <= def.range.max; n += 1) values.push(n);
  return values;
}

export const optionAllows = (def: OptionDef, value: OptionValue): boolean =>
  allowedOptionValues(def).includes(value);

/** The allowed width closest to `width`; the narrower one on a tie. */
export function nearestAllowedWidth(entry: CatalogEntry, width: Len): Len {
  // Never empty: an entry comes in at least one width.
  return allowedWidths(entry).reduce((best, candidate) =>
    Math.abs(candidate - width) < Math.abs(best - width) ? candidate : best,
  );
}

function widthError(item: Item, entry: CatalogEntry): ConstraintError | null {
  const allowed = allowedWidths(entry);
  if (allowed.includes(item.width)) return null;
  // Only fillers come at an arbitrary width; everything else sits on the 3 in grid.
  const offStep = !isFree(entry) && item.width % STEP !== 0;
  return {
    code: offStep ? 'WIDTH_OFF_STEP' : 'WIDTH_OUT_OF_RANGE',
    message: `Width ${formatLength(item.width)} is not allowed for ${entry.id}. Use ${describeWidths(entry)}.`,
    allowed,
  };
}

function depthError(item: Item, entry: CatalogEntry): ConstraintError | null {
  if (!entry.depths.includes(item.depth)) {
    return {
      code: 'DEPTH_NOT_STANDARD',
      message: `Depth ${formatLength(item.depth)} is not standard for ${entry.id}. Use ${lengths(entry.depths)}.`,
      allowed: entry.depths,
    };
  }
  const square = entry.corner === 'l' || entry.corner === 'diagonal';
  if (square && item.depth !== item.width) {
    return {
      code: 'DEPTH_NOT_STANDARD',
      message: `Depth ${formatLength(item.depth)} must match the width for ${entry.id}. Use ${formatLength(item.width)}.`,
      allowed: [item.width],
    };
  }
  return null;
}

function optionErrors(item: Item, entry: CatalogEntry): ConstraintError[] {
  const errors: ConstraintError[] = [];
  for (const [key, value] of Object.entries(item.options)) {
    const def = entry.options.find((option) => option.key === key);
    if (!def) {
      const keys = entry.options.map((option) => option.key);
      errors.push({
        code: 'OPTION_INVALID',
        message:
          keys.length === 0
            ? `${entry.id} has no options, so "${key}" is not allowed.`
            : `${entry.id} has no option "${key}". Its options are ${listed(keys)}.`,
        allowed: keys,
        option: key,
      });
    } else if (!optionAllows(def, value)) {
      const allowed = allowedOptionValues(def);
      errors.push({
        code: 'OPTION_INVALID',
        message: `Option "${key}" of ${entry.id} cannot be ${JSON.stringify(value)}. Use ${listed(allowed.map(String))}.`,
        allowed,
        option: key,
      });
    }
  }
  return errors;
}

/**
 * Everything about the item that its catalog entry does not allow, or an empty list.
 * An option the item leaves out is fine: it takes the entry's default.
 */
export function checkItemAgainstCatalog(
  item: Item,
  catalog: Catalog,
  /** Set for an item that is being added: a retired entry may not be added, only kept. */
  options: { adding?: boolean } = {},
): ConstraintError[] {
  const entry = getEntry(catalog, item.catalogId);
  if (!entry) {
    const ids = activeEntries(catalog).map((candidate) => candidate.id);
    return [
      {
        code: 'UNKNOWN_CATALOG_ID',
        message: `The catalog has no entry "${item.catalogId}". Use ${listed(ids)}.`,
        allowed: ids,
      },
    ];
  }

  const errors: ConstraintError[] = [];
  if (options.adding && entry.retired) {
    const ids = activeEntries(catalog)
      .filter((candidate) => candidate.kind === entry.kind)
      .map((candidate) => candidate.id);
    errors.push({
      code: 'ENTRY_RETIRED',
      message: `${entry.id} is retired and cannot be added.${ids.length > 0 ? ` Use ${listed(ids)}.` : ''}`,
      allowed: ids,
    });
  }
  if (item.kind !== entry.kind) {
    errors.push({
      code: 'KIND_MISMATCH',
      message: `${entry.id} is of kind "${entry.kind}", not "${item.kind}".`,
      allowed: [entry.kind],
    });
  }
  const width = widthError(item, entry);
  if (width) errors.push(width);
  if (!entry.heights.includes(item.height)) {
    errors.push({
      code: 'HEIGHT_NOT_STANDARD',
      message: `Height ${formatLength(item.height)} is not standard for ${entry.id}. Use ${lengths(entry.heights)}.`,
      allowed: entry.heights,
    });
  }
  const depth = depthError(item, entry);
  if (depth) errors.push(depth);
  errors.push(...optionErrors(item, entry));
  if (!entry.placement.includes(item.placement.type)) {
    errors.push({
      code: 'PLACEMENT_NOT_ALLOWED',
      message: `${entry.id} cannot be placed "${item.placement.type}". Use ${listed(entry.placement)}.`,
      allowed: entry.placement,
    });
  }
  return errors;
}
