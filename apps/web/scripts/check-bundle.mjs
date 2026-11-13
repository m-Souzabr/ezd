// Fails when the JavaScript and CSS the browser loads before the editor can start, gzipped,
// exceed the budget from #12. Reads dist/index.html after `vite build`: its scripts, its
// stylesheets and its module preloads. Chunks loaded later (the PDF renderer) do not count.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 350 * 1024;

const dist = resolve(import.meta.dirname, '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);

let total = 0;
for (const asset of new Set(assets)) {
  const size = gzipSync(readFileSync(join(dist, asset)), { level: 9 }).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} kB  ${asset}`);
}
console.log(
  `${(total / 1024).toFixed(1).padStart(8)} kB  initial, gzipped (budget ${BUDGET_BYTES / 1024} kB)`,
);
if (total > BUDGET_BYTES) {
  console.error('The initial bundle is over budget. Load something lazily, or record the miss.');
  process.exit(1);
}
