import { inches, SEED_CATALOG } from '@ezd/core';
import { expect, it } from 'vitest';

import { newItem } from './edits';
import { itemCode } from './labels';

const code = (catalogId: string, width?: number, height?: number) => {
  const entry = SEED_CATALOG.entries.find((candidate) => candidate.id === catalogId)!;
  const item = newItem(
    entry,
    width === undefined ? entry.defaultSize.width : inches(width),
    'item-000001',
  );
  return itemCode(height === undefined ? item : { ...item, height: inches(height) });
};

it('labels cabinets with a prefix, the width and, where it varies, the height', () => {
  expect(code('base.standard', 30)).toBe('B30');
  expect(code('wall.standard', 36, 30)).toBe('W3630');
  expect(code('base.sink')).toBe('SB36');
  expect(code('tall.pantry')).toBe('T2484');
  expect(code('filler.base', 3.5)).toBe('BF3.5');
  expect(code('panel.end')).toBe('EP');
  expect(code('appliance.fridge')).toBe('REF36');
});

it('falls back to the kind for an entry it does not know', () => {
  expect(itemCode({ catalogId: 'base.custom', kind: 'base', width: inches(18), height: 552 })).toBe(
    'B18',
  );
  expect(itemCode({ catalogId: 'x', kind: 'wall', width: inches(18), height: inches(42) })).toBe(
    'W1842',
  );
});

it('gives every seed entry a code of its own', () => {
  const codes = SEED_CATALOG.entries
    .filter((entry) => entry.id !== 'wall.fridge')
    .map((entry) => code(entry.id).replace(/[\d.]+$/, ''));
  expect(new Set(codes).size).toBe(codes.length);
});
