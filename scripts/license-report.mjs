// Writes the dependency license report attached to a release: licenses-report/js.csv for
// every pnpm workspace and licenses-report/python.md for apps/api.
//
//   node scripts/license-report.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'licenses-report');
mkdirSync(out, { recursive: true });

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr}`);
  return result.stdout;
}

const js = run(join(root, 'node_modules', '.bin', 'license-checker-rseidelsohn'), [
  '--start',
  root,
  '--excludePrivatePackages',
  '--csv',
]);
writeFileSync(join(out, 'js.csv'), js);

const python = run(
  'uv',
  ['run', 'pip-licenses', '--format=markdown', '--with-urls', '--order=license'],
  join(root, 'apps', 'api'),
);
writeFileSync(join(out, 'python.md'), python);
console.log(`wrote ${out}/js.csv and ${out}/python.md`);
