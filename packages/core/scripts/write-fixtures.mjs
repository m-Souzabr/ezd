// Writes the 200 and 500-item fixture designs in src/document/fixtures from the generator
// the performance tests use (src/test/large.ts). Run through `pnpm --filter @ezd/core
// schema`; src/document/fixtures.test.ts fails when the files are stale.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const bundled = await build({
  stdin: {
    contents: "export { largeKitchenFixture } from './src/test/large.ts';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const url = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { largeKitchenFixture } = await import(url);
for (const count of [200, 500]) {
  const path = join(root, 'src', 'document', 'fixtures', `kitchen-${count}.json`);
  writeFileSync(path, `${JSON.stringify(largeKitchenFixture(count))}\n`);
  console.log(`wrote src/document/fixtures/kitchen-${count}.json`);
}
