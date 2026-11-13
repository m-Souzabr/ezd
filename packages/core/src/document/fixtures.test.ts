import { describe, expect, it } from 'vitest';

import { largeKitchenFixture } from '../test/large.js';
import kitchen200 from './fixtures/kitchen-200.json' with { type: 'json' };
import kitchen500 from './fixtures/kitchen-500.json' with { type: 'json' };
import { parseDocument } from './index.js';

// The 200 and 500-item designs that the API's autosave benchmark and the browser's drag
// test load. `pnpm --filter @ezd/core schema` writes them from `largeKitchen`.
describe.each([
  [200, kitchen200],
  [500, kitchen500],
] as const)('the %i-item fixture', (count, stored) => {
  it('matches the generator and is a valid document', () => {
    expect(stored).toEqual(largeKitchenFixture(count));
    const parsed = parseDocument(stored);
    expect(parsed.ok && parsed.value.items).toHaveLength(count);
  });
});
