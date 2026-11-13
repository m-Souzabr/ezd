import { describe, expect, it } from 'vitest';

import { SEED_CATALOG } from '../catalog/index.js';
import { validate } from '../rules/index.js';
import { clone } from '../test/fixtures.js';
import kitchenV1 from './fixtures/v1/kitchen.json' with { type: 'json' };
import { migrate } from './migrate.js';

// Documents saved by earlier releases must keep opening. The files in fixtures/v<N>/ are
// never edited: when the schema changes, add a migration, never change these.
describe('a document saved at schema version 1', () => {
  it('still opens, with everything in it', () => {
    const opened = migrate(clone(kitchenV1));
    if (!opened.ok) throw new Error(opened.error.message);
    const doc = opened.value;
    expect(doc.room.walls).toHaveLength(4);
    expect(doc.room.openings.map((o) => o.kind)).toEqual(['door', 'window']);
    expect(doc.items.map((item) => item.catalogId)).toEqual([
      'base.standard',
      'base.sink',
      'appliance.dishwasher',
      'wall.standard',
      'base.drawers',
    ]);
    expect(doc.countertops).toHaveLength(1);
    expect(doc.finishes).toEqual(kitchenV1.finishes);
  });

  it('is a design the seed catalog accepts', () => {
    const opened = migrate(clone(kitchenV1));
    if (!opened.ok) throw new Error(opened.error.message);
    const errors = validate(opened.value, SEED_CATALOG).filter((v) => v.severity === 'error');
    expect(errors).toEqual([]);
  });
});
