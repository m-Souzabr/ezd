// Fails on a TODO or FIXME that does not link an issue, such as `TODO(#42)` or a GitHub
// issue URL on the same line. Reads the files git tracks.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'git',
  [
    'grep',
    '-nIE',
    '\\b(TODO|FIXME)\\b',
    '--',
    '.',
    ':!scripts/check-todos.mjs',
    ':!pnpm-lock.yaml',
    ':!apps/api/uv.lock',
  ],
  { encoding: 'utf8' },
);
const lines = result.stdout.split('\n').filter(Boolean);
const unlinked = lines.filter((line) => !/#\d+|github\.com\/[^ ]+\/issues\/\d+/.test(line));
for (const line of unlinked) console.error(line);
if (unlinked.length > 0) {
  console.error(`\n${unlinked.length} TODO or FIXME without a linked issue.`);
  process.exit(1);
}
console.log(`ok    ${lines.length} TODO or FIXME, each with a linked issue`);
