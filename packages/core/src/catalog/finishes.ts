import type { Finish } from './types.js';

/** Generic seed finishes. Flat colours only; names describe the colour, not a product. */
export const SEED_FINISHES: Finish[] = [
  { id: 'cabinet.white', name: 'White', target: 'cabinet', color: '#f4f3ef' },
  { id: 'cabinet.navy', name: 'Navy', target: 'cabinet', color: '#27364a' },
  { id: 'cabinet.sage', name: 'Sage green', target: 'cabinet', color: '#8a9a82' },
  { id: 'cabinet.oak', name: 'Natural oak', target: 'cabinet', color: '#c8a877' },
  { id: 'countertop.white', name: 'White stone', target: 'countertop', color: '#ecebe6' },
  { id: 'countertop.charcoal', name: 'Charcoal stone', target: 'countertop', color: '#3a3b3d' },
  { id: 'countertop.butcher', name: 'Butcher block', target: 'countertop', color: '#b58450' },
  { id: 'wall.white', name: 'Soft white', target: 'wall', color: '#f7f5f0' },
  { id: 'wall.greige', name: 'Greige', target: 'wall', color: '#d6cfc3' },
  { id: 'floor.oak', name: 'Light oak', target: 'floor', color: '#d2b48c' },
  { id: 'floor.slate', name: 'Slate grey', target: 'floor', color: '#6b6f73' },
];
