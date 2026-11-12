import { type Item, type ItemKind, toInches } from '@ezd/core';

// The short codes drawn on items, in the generic trade style: a prefix, the width in
// inches and, where the height varies, the height: `B30`, `W3630`.

type Code = { prefix: string; height?: boolean; width?: boolean };

const BY_CATALOG_ID: Record<string, Code> = {
  'base.standard': { prefix: 'B' },
  'base.drawers': { prefix: 'DB' },
  'base.sink': { prefix: 'SB' },
  'base.corner.blind': { prefix: 'BBC' },
  'base.corner.susan': { prefix: 'LS' },
  'wall.standard': { prefix: 'W', height: true },
  'wall.fridge': { prefix: 'W', height: true },
  'wall.corner.diagonal': { prefix: 'WDC', height: true },
  'tall.pantry': { prefix: 'T', height: true },
  'tall.oven': { prefix: 'OC', height: true },
  'filler.base': { prefix: 'BF' },
  'filler.wall': { prefix: 'WF' },
  'filler.tall': { prefix: 'TF' },
  'panel.end': { prefix: 'EP', width: false },
  'appliance.range': { prefix: 'RNG' },
  'appliance.fridge': { prefix: 'REF' },
  'appliance.dishwasher': { prefix: 'DW' },
  'appliance.hood': { prefix: 'HD' },
  'appliance.microwave': { prefix: 'MW' },
};

const BY_KIND: Record<ItemKind, Code> = {
  base: { prefix: 'B' },
  wall: { prefix: 'W', height: true },
  tall: { prefix: 'T', height: true },
  corner: { prefix: 'C' },
  appliance: { prefix: 'A' },
  filler: { prefix: 'F' },
  panel: { prefix: 'P', width: false },
};

/** Whole inches as they are; anything else to two decimals, so `3.5` and `0.75`. */
const number = (len: number): string => String(Math.round(toInches(len) * 100) / 100);

export function itemCode(item: Pick<Item, 'catalogId' | 'kind' | 'width' | 'height'>): string {
  const code = BY_CATALOG_ID[item.catalogId] ?? BY_KIND[item.kind];
  const width = code.width === false ? '' : number(item.width);
  return `${code.prefix}${width}${code.height ? number(item.height) : ''}`;
}
