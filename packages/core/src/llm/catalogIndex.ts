import {
  activeEntries,
  activeFinishes,
  allowedOptionValues,
  type Catalog,
  type CatalogEntry,
} from '../catalog/index.js';
import { inchesText } from './summary.js';

// The catalog as compact text for the model. Part of the prompt prefix that is identical on
// every request, so it must be deterministic.

const list = (values: readonly number[]): string => values.map(inchesText).join(', ');

function widths(entry: CatalogEntry): string {
  const { width } = entry;
  if ('values' in width) return list(width.values);
  if ('free' in width) {
    return `any from ${inchesText(width.free.min)} to ${inchesText(width.free.max)} (filler)`;
  }
  return `${inchesText(width.min)} to ${inchesText(width.max)} in steps of ${inchesText(width.step)}`;
}

function entryLine(entry: CatalogEntry): string {
  const { width, height, depth } = entry.defaultSize;
  const fields = [
    entry.id,
    entry.name,
    `kind ${entry.kind}`,
    `widths ${widths(entry)}`,
    `heights ${list(entry.heights)}`,
    `depths ${list(entry.depths)}`,
    `default ${inchesText(width)} x ${inchesText(height)} x ${inchesText(depth)} at elevation ${inchesText(entry.defaultElevation)}`,
    `placement ${entry.placement.join(', ')}`,
  ];
  if (entry.options.length > 0) {
    const options = entry.options.map(
      (def) =>
        `${def.key} ${allowedOptionValues(def).map(String).join('|')} (default ${String(def.default)})`,
    );
    fields.push(`options ${options.join('; ')}`);
  }
  return fields.join(' | ');
}

/** Every entry with its allowed sizes and options, then every finish. Lengths in inches. */
export function catalogIndexForLLM(catalog: Catalog): string {
  return [
    `Catalog ${catalog.version}. Sizes in inches: width x height x depth.`,
    'Entries (id | name | kind | widths | heights | depths | default size | placement | options):',
    ...activeEntries(catalog).map(entryLine),
    'Finishes (id | name | applies to):',
    ...activeFinishes(catalog).map((finish) => `${finish.id} | ${finish.name} | ${finish.target}`),
  ].join('\n');
}
