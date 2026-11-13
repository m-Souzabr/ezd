import { getEntry, SEED_CATALOG } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import {
  bpsToPercent,
  changeEntry,
  diffCatalogs,
  formatDollars,
  formatLengthList,
  newEntry,
  parseDollars,
  parseLengthList,
  percentToBps,
  withRetired,
} from './helpers';

describe('money', () => {
  it('reads dollars as integer cents', () => {
    expect(parseDollars('12')).toBe(1200);
    expect(parseDollars('$1,234.5')).toBe(123450);
    expect(parseDollars('0.07')).toBe(7);
    for (const bad of ['', 'abc', '-3', '1.234', '1,2,3.00x']) expect(parseDollars(bad)).toBeNull();
  });

  it('writes cents as dollars', () => {
    expect(formatDollars(0)).toBe('0.00');
    expect(formatDollars(12005)).toBe('120.05');
  });

  it('reads and writes a multiplier as a percent', () => {
    expect(percentToBps('110')).toBe(11000);
    expect(percentToBps('97.5%')).toBe(9750);
    expect(percentToBps('x')).toBeNull();
    expect(bpsToPercent(11000)).toBe('110');
    expect(bpsToPercent(9750)).toBe('97.5');
  });
});

describe('length lists', () => {
  it('parses inches with fractions, and names the one that is wrong', () => {
    expect(parseLengthList('9, 34 1/2')).toEqual({ ok: true, value: [144, 552] });
    expect(parseLengthList('')).toEqual({ ok: true, value: [] });
    const bad = parseLengthList('9, abc');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('"abc"');
    expect(formatLengthList([144, 552])).toBe('9", 34 1/2"');
  });
});

describe('editing helpers', () => {
  it('changes one entry and leaves the rest', () => {
    const next = changeEntry(SEED_CATALOG, 'base.standard', (e) => ({ ...e, name: 'X' }));
    expect(getEntry(next, 'base.standard')!.name).toBe('X');
    expect(getEntry(next, 'base.drawers')).toBe(getEntry(SEED_CATALOG, 'base.drawers'));
  });

  it('keeps retired as true or absent', () => {
    const entry = getEntry(SEED_CATALOG, 'base.standard')!;
    expect(withRetired(entry, true).retired).toBe(true);
    expect('retired' in withRetired(withRetired(entry, true), false)).toBe(false);
  });

  it('starts a new entry as a valid copy of one of its kind', () => {
    const entry = newEntry(SEED_CATALOG, 'wall', 'wall.deep', 'Deep wall cabinet');
    expect(entry).toMatchObject({ id: 'wall.deep', name: 'Deep wall cabinet', kind: 'wall' });
    expect(entry.price).toEqual(getEntry(SEED_CATALOG, 'wall.standard')!.price);
    expect(
      newEntry(
        { ...SEED_CATALOG, entries: [getEntry(SEED_CATALOG, 'base.standard')!] },
        'tall',
        'a.b',
        'A',
      ).id,
    ).toBe('a.b');
  });
});

describe('diffCatalogs', () => {
  it('lists what was added, edited, retired and restored', () => {
    const retired = changeEntry(SEED_CATALOG, 'base.drawers', (e) => withRetired(e, true));
    const edited = changeEntry(retired, 'base.standard', (e) => ({ ...e, name: 'Renamed' }));
    const withNew = {
      ...edited,
      entries: [...edited.entries, newEntry(edited, 'base', 'base.new', 'New')],
      finishes: [
        ...edited.finishes,
        { id: 'cabinet.teal', name: 'Teal', target: 'cabinet' as const, color: '#008080' },
      ],
    };
    expect(diffCatalogs(SEED_CATALOG, SEED_CATALOG)).toEqual([]);
    const changes = diffCatalogs(SEED_CATALOG, withNew).map((c) => `${c.kind} ${c.id} ${c.what}`);
    expect(changes).toEqual([
      'entry base.standard changed name',
      'entry base.drawers retired',
      'entry base.new added',
      'finish cabinet.teal added',
    ]);
    expect(diffCatalogs(withNew, SEED_CATALOG).map((c) => c.what)).toContain('restored');
  });
});
