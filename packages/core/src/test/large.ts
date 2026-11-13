import type { DesignDocument } from '../document/index.js';
import { door, free, type ItemSpec, kitchen, on, windowAt } from './kitchen.js';

/**
 * A large kitchen with exactly `count` items: base and wall cabinets round every wall,
 * then rows of island cabinets. 200 items fit a 60 ft by 50 ft room; more get a larger one.
 * The performance tests and the 200 and 500-item fixtures come from it.
 */
export function largeKitchen(count = 200): DesignDocument {
  const width = count <= 200 ? 720 : 1440;
  const depth = count <= 200 ? 600 : 1200;
  const specs: ItemSpec[] = [];
  for (const [wallId, length] of [
    ['wall-north', width],
    ['wall-east', depth],
    ['wall-south', width],
    ['wall-west', depth],
  ] as const) {
    for (let at = 24; at + 30 <= length - 24; at += 30) {
      if (specs.length + 2 > count) break;
      specs.push(on('base.standard', wallId, at), on('wall.standard', wallId, at));
    }
  }
  const columns = Math.floor((width - 240) / 60);
  for (let i = 0; specs.length < count; i += 1) {
    specs.push(free('base.standard', 120 + (i % columns) * 60, 150 + Math.floor(i / columns) * 80));
  }
  return kitchen(specs, {
    width,
    depth,
    openings: [door('wall-south', 300, 32, 'in-left'), windowAt('wall-north', 300, 48)],
  });
}

/** The stored 200 and 500-item fixtures (`src/document/fixtures/kitchen-<count>.json`). */
export const largeKitchenFixture = (count: number): DesignDocument => ({
  ...largeKitchen(count),
  id: `fixture-${count}`,
  name: `${count}-item kitchen`,
});
