import {
  type Catalog,
  type CatalogEntry,
  type CatalogProblem,
  formatLength,
  type Len,
  parseLength,
} from '@ezd/core';

/** `12.5` or `$1,234.50` to cents, or null if it is not an amount of money. */
export function parseDollars(text: string): number | null {
  const match = /^\s*\$?\s*(\d[\d,]*)(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const dollars = Number(match[1]!.replaceAll(',', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return dollars * 100 + cents;
}

/** Cents to dollars with two decimals, without the sign: `1250` is `12.50`. */
export const formatDollars = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** A multiplier in basis points as a percent: `11500` is `115`. */
export const bpsToPercent = (bps: number): string => String(bps / 100);

/** A percent such as `115` or `97.5` to basis points, or null. */
export function percentToBps(text: string): number | null {
  const match = /^\s*(\d+)(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** `9, 12, 15 1/2` to lengths, or why one of them is not a length. */
export function parseLengthList(
  text: string,
): { ok: true; value: Len[] } | { ok: false; message: string } {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const value: Len[] = [];
  for (const part of parts) {
    const parsed = parseLength(part);
    if (!parsed.ok) return { ok: false, message: `"${part}": ${parsed.error.message}` };
    value.push(parsed.value);
  }
  return { ok: true, value };
}

export const formatLengthList = (lengths: readonly Len[]): string =>
  lengths.map((length) => formatLength(length)).join(', ');

/** A copy of the catalog with the entry that has `id` replaced by `change(entry)`. */
export function changeEntry(
  catalog: Catalog,
  id: string,
  change: (entry: CatalogEntry) => CatalogEntry,
): Catalog {
  return { ...catalog, entries: catalog.entries.map((e) => (e.id === id ? change(e) : e)) };
}

export function changeFinish(
  catalog: Catalog,
  id: string,
  change: (finish: Catalog['finishes'][number]) => Catalog['finishes'][number],
): Catalog {
  return { ...catalog, finishes: catalog.finishes.map((f) => (f.id === id ? change(f) : f)) };
}

/** `retired: true` or no `retired` key at all, never `retired: false`. */
export function withRetired<T extends { retired?: boolean | undefined }>(
  value: T,
  retired: boolean,
): T {
  const next = { ...value };
  if (retired) next.retired = true;
  else delete next.retired;
  return next;
}

/** A new entry that starts as a copy of the first one of its kind, so it is already valid. */
export function newEntry(
  catalog: Catalog,
  kind: CatalogEntry['kind'],
  id: string,
  name: string,
): CatalogEntry {
  const template = catalog.entries.find((entry) => entry.kind === kind) ?? catalog.entries[0]!;
  return { ...withRetired(template, false), id, name, kind };
}

/** The problems of entry `index`, in the order core found them. */
export const problemsOfEntry = (problems: readonly CatalogProblem[], index: number) =>
  problems.filter((problem) => problem.path.startsWith(`entries.${index}.`));

export type Change = { kind: 'entry' | 'finish'; id: string; what: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function describeDifference<T extends Record<string, unknown>>(before: T, after: T): string {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((key) => !same(before[key], after[key]));
  const retired = changed.includes('retired');
  const rest = changed.filter((key) => key !== 'retired');
  const parts = [];
  if (retired) parts.push(after['retired'] ? 'retired' : 'restored');
  if (rest.length > 0) parts.push(`changed ${rest.join(', ')}`);
  return parts.join('; ');
}

/** What publishing would change: entries and finishes added, retired, restored or edited. */
export function diffCatalogs(published: Catalog, draft: Catalog): Change[] {
  const changes: Change[] = [];
  for (const kind of ['entry', 'finish'] as const) {
    const before: Map<string, Record<string, unknown>> = new Map(
      (kind === 'entry' ? published.entries : published.finishes).map((item) => [
        item.id,
        item as unknown as Record<string, unknown>,
      ]),
    );
    const after = kind === 'entry' ? draft.entries : draft.finishes;
    for (const item of after) {
      const old = before.get(item.id);
      if (!old) changes.push({ kind, id: item.id, what: 'added' });
      else {
        const what = describeDifference(old, item as unknown as Record<string, unknown>);
        if (what) changes.push({ kind, id: item.id, what });
      }
    }
  }
  return changes;
}
