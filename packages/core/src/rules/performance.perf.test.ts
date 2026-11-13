import { describe, expect, it } from 'vitest';

import { defaultItemFor, getEntry, SEED_CATALOG } from '../catalog/index.js';
import { snap } from '../snapping/index.js';
import { largeKitchen } from '../test/large.js';
import { inches } from '../units/index.js';
import { validate } from './index.js';

// Targets from the phase issue, on CI hardware: `validate` on a 200-item document in under
// 10 ms and `snap` in under 4 ms. Run by vitest.perf.config.ts, without coverage, which
// slows the code several times over.
// Core has no `console` in its types; the timings are printed for docs/PERFORMANCE.md.
declare const console: { log(message: string): void };

const VALIDATE_BUDGET_MS = 10;
const SNAP_BUDGET_MS = 4;

/** Mean time of one call in milliseconds, once the code is warm. */
function meanMs(run: (i: number) => void): number {
  const runs = 100;
  for (let i = 0; i < 30; i += 1) run(i);
  const start = Date.now();
  for (let i = 0; i < runs; i += 1) run(i);
  return (Date.now() - start) / runs;
}

describe('performance on a 200-item document', () => {
  const doc = largeKitchen(200);

  it('has 200 items and plenty for the rules to find', () => {
    expect(doc.items).toHaveLength(200);
    expect(validate(doc, SEED_CATALOG).length).toBeGreaterThan(20);
  });

  it(`validates in under ${VALIDATE_BUDGET_MS} ms`, () => {
    expect(meanMs(() => validate(doc, SEED_CATALOG))).toBeLessThan(VALIDATE_BUDGET_MS);
  });

  it(`snaps in under ${SNAP_BUDGET_MS} ms`, () => {
    const item = defaultItemFor(getEntry(SEED_CATALOG, 'base.standard')!, 'item-new-0001');
    const mean = meanMs((i) =>
      snap({ doc, catalog: SEED_CATALOG, item, pointer: { x: inches(100 + i), y: inches(5) } }),
    );
    expect(mean).toBeLessThan(SNAP_BUDGET_MS);
    console.log(`200 items: snap ${mean.toFixed(3)} ms`);
  });

  it('prints the validate time, for docs/PERFORMANCE.md', () => {
    console.log(`200 items: validate ${meanMs(() => validate(doc, SEED_CATALOG)).toFixed(3)} ms`);
  });
});

// No target for 500 items: twice the budget is the point where a design this size would
// feel slow, so a regression past it fails.
describe('performance on a 500-item document', () => {
  const doc = largeKitchen(500);

  it('has 500 items', () => {
    expect(doc.items).toHaveLength(500);
  });

  it(`validates in under ${2 * VALIDATE_BUDGET_MS} ms and snaps in under ${2 * SNAP_BUDGET_MS} ms`, () => {
    const validateMs = meanMs(() => validate(doc, SEED_CATALOG));
    const item = defaultItemFor(getEntry(SEED_CATALOG, 'base.standard')!, 'item-new-0001');
    const snapMs = meanMs((i) =>
      snap({ doc, catalog: SEED_CATALOG, item, pointer: { x: inches(100 + i), y: inches(5) } }),
    );
    console.log(`500 items: validate ${validateMs.toFixed(3)} ms, snap ${snapMs.toFixed(3)} ms`);
    expect(validateMs).toBeLessThan(2 * VALIDATE_BUDGET_MS);
    expect(snapMs).toBeLessThan(2 * SNAP_BUDGET_MS);
  });
});
