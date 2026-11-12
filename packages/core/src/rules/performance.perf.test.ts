import { describe, expect, it } from 'vitest';

import { defaultItemFor, getEntry, SEED_CATALOG } from '../catalog/index.js';
import { snap } from '../snapping/index.js';
import { door, free, type ItemSpec, kitchen, on, windowAt } from '../test/kitchen.js';
import { inches } from '../units/index.js';
import { validate } from './index.js';

// Targets from the phase issue, on CI hardware: `validate` on a 200-item document in under
// 10 ms and `snap` in under 4 ms. Run by vitest.perf.config.ts, without coverage, which
// slows the code several times over.
const VALIDATE_BUDGET_MS = 10;
const SNAP_BUDGET_MS = 4;

/** A 60 ft by 50 ft kitchen: base and wall cabinets round every wall, and islands. */
function largeKitchen() {
  const specs: ItemSpec[] = [];
  for (const [wallId, length] of [
    ['wall-north', 720],
    ['wall-east', 600],
    ['wall-south', 720],
    ['wall-west', 600],
  ] as const) {
    for (let at = 24; at + 30 <= length - 24; at += 30) {
      specs.push(on('base.standard', wallId, at), on('wall.standard', wallId, at));
    }
  }
  for (let i = 0; specs.length < 200; i += 1) {
    specs.push(free('base.standard', 120 + (i % 8) * 60, 150 + Math.floor(i / 8) * 80));
  }
  return kitchen(specs, {
    width: 720,
    depth: 600,
    openings: [door('wall-south', 300, 32, 'in-left'), windowAt('wall-north', 300, 48)],
  });
}

/** Mean time of one call in milliseconds, once the code is warm. */
function meanMs(run: (i: number) => void): number {
  const runs = 100;
  for (let i = 0; i < 30; i += 1) run(i);
  const start = Date.now();
  for (let i = 0; i < runs; i += 1) run(i);
  return (Date.now() - start) / runs;
}

describe('performance on a 200-item document', () => {
  const doc = largeKitchen();

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
  });
});
