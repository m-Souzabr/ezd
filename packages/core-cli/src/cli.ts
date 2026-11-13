import { readFileSync } from 'node:fs';

import { readsStdin, run } from './run.js';

// `--catalog <file>` is read here, so `run` stays free of the file system.
const args = process.argv.slice(2);
const at = args.indexOf('--catalog');
let catalogFile: string | undefined;
if (at >= 0) {
  const path = args[at + 1];
  if (path === undefined) {
    process.stderr.write('ezd-core: --catalog needs a file\n');
    process.exit(2);
  }
  try {
    catalogFile = readFileSync(path, 'utf8');
  } catch (error) {
    process.stderr.write(`ezd-core: cannot read ${path}: ${(error as Error).message}\n`);
    process.exit(2);
  }
  args.splice(at, 2);
}

const result = run(args, readsStdin(args) ? readFileSync(0, 'utf8') : '', {
  ...(catalogFile !== undefined && { catalogFile }),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
