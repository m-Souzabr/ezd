import type { Catalog } from '../catalog/index.js';
import type {
  Countertop,
  DesignDocument,
  FinishTarget,
  Item,
  Opening,
  Placement,
} from '../document/index.js';
import { wallLabel } from '../rules/index.js';
import { formatLength } from '../units/index.js';

// The change list shown with a proposal: one plain-English line per change, lengths in
// inches with fractions, items named as the user sees them.

function itemName(catalog: Catalog, item: Item): string {
  const entry = catalog.entries.find((candidate) => candidate.id === item.catalogId);
  // The seed names say how a corner cabinet is measured, in brackets. Leave that out.
  const name = (entry?.name ?? item.catalogId).replace(/\s*\(.*\)$/, '');
  return `${formatLength(item.width)} ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

function where(doc: DesignDocument, placement: Placement): string {
  return placement.type === 'wall'
    ? `on wall ${wallLabel(doc, placement.wallId)} at ${formatLength(placement.offset)}`
    : `free-standing at (${formatLength(placement.x)}, ${formatLength(placement.y)})`;
}

const samePlacement = (a: Placement, b: Placement): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function finishName(catalog: Catalog, id: string | undefined): string {
  return catalog.finishes.find((finish) => finish.id === id)?.name ?? id ?? 'the default';
}

function describeItemChange(
  doc: DesignDocument,
  next: DesignDocument,
  catalog: Catalog,
  before: Item,
  after: Item,
): string[] {
  const name = `${itemName(catalog, before)} ${where(doc, before.placement)}`;
  const lines: string[] = [];
  if (!samePlacement(before.placement, after.placement)) {
    lines.push(`Move ${name} to ${where(next, after.placement).replace(/^on /, '')}`);
  }
  if (before.elevation !== after.elevation) {
    const verb = after.elevation > before.elevation ? 'Raise' : 'Lower';
    lines.push(`${verb} ${name} to ${formatLength(after.elevation)} above the floor`);
  }
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.depth !== after.depth
  ) {
    const size = [after.width, after.height, after.depth].map(formatLength).join(' x ');
    lines.push(`Resize ${name} to ${size}`);
  }
  const keys = [...new Set([...Object.keys(before.options), ...Object.keys(after.options)])].sort();
  const changed = keys.filter((key) => before.options[key] !== after.options[key]);
  if (changed.length > 0) {
    const values = changed.map((key) => `${key} ${String(after.options[key] ?? 'default')}`);
    lines.push(`Set ${values.join(', ')} on ${name}`);
  }
  if (before.finishId !== after.finishId) {
    lines.push(`Set the finish of ${name} to ${finishName(catalog, after.finishId)}`);
  }
  return lines;
}

function openingName(doc: DesignDocument, opening: Opening): string {
  return `${formatLength(opening.width)} ${opening.kind} on wall ${wallLabel(doc, opening.wallId)} at ${formatLength(opening.offset)}`;
}

function countertopName(doc: DesignDocument, top: Countertop): string {
  return `countertop on wall ${wallLabel(doc, top.wallId)} from ${formatLength(top.startOffset)} to ${formatLength(top.endOffset)}`;
}

/** Lines for the entities of one list: removed first, then changed, then added. */
function diff<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  removed: (entity: T) => string,
  changed: (from: T, to: T) => string[],
  added: (entity: T) => string,
): string[] {
  const afterById = new Map(after.map((entity) => [entity.id, entity]));
  const beforeById = new Map(before.map((entity) => [entity.id, entity]));
  return [
    ...before.filter((entity) => !afterById.has(entity.id)).map(removed),
    ...after.flatMap((entity) => {
      const old = beforeById.get(entity.id);
      return old && JSON.stringify(old) !== JSON.stringify(entity) ? changed(old, entity) : [];
    }),
    ...after.filter((entity) => !beforeById.has(entity.id)).map(added),
  ];
}

/** What changes from `doc` to `next`, one line per change, for example `Add 30" base cabinet on wall A at 36"`. */
export function describeProposal(
  doc: DesignDocument,
  next: DesignDocument,
  catalog: Catalog,
): string[] {
  const items = diff(
    doc.items,
    next.items,
    (item) => `Remove ${itemName(catalog, item)} ${where(doc, item.placement)}`,
    (before, after) => describeItemChange(doc, next, catalog, before, after),
    (item) => `Add ${itemName(catalog, item)} ${where(next, item.placement)}`,
  );
  const openings = diff(
    doc.room.openings,
    next.room.openings,
    (opening) => `Remove ${openingName(doc, opening)}`,
    (before, after) => [`Change ${openingName(doc, before)} to ${openingName(next, after)}`],
    (opening) => `Add ${openingName(next, opening)}`,
  );
  const countertops = diff(
    doc.countertops,
    next.countertops,
    (top) => `Remove ${countertopName(doc, top)}`,
    (before, after) => [`Change ${countertopName(doc, before)} to ${countertopName(next, after)}`],
    (top) => `Add ${countertopName(next, top)}`,
  );
  const targets: FinishTarget[] = ['cabinet', 'countertop', 'wall', 'floor'];
  const finishes = targets
    .filter((target) => doc.finishes[target] !== next.finishes[target])
    .map((target) => `Set the ${target} finish to ${finishName(catalog, next.finishes[target])}`);
  return [...items, ...openings, ...countertops, ...finishes];
}
