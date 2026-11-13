import { readFileSync } from 'node:fs';

import { readsStdin, run } from './run.js';

// `--catalog <file>` and `--rules <file>` are read here, so `run` stays free of the file system.
const args = process.argv.slice(2);

function takeFile(flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const path = args[at + 1];
  if (path === undefined) {
    process.stderr.write(`ezd-core: ${flag} needs a file\n`);
    process.exit(2);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    process.stderr.write(`ezd-core: cannot read ${path}: ${(error as Error).message}\n`);
    process.exit(2);
  }
  args.splice(at, 2);
  return text;
}

const catalogFile = takeFile('--catalog');
const rulesFile = takeFile('--rules');

const result = run(args, readsStdin(args) ? readFileSync(0, 'utf8') : '', {
  ...(catalogFile !== undefined && { catalogFile }),
  ...(rulesFile !== undefined && { rulesFile }),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
