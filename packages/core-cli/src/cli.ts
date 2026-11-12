import { readFileSync } from 'node:fs';

import { readsStdin, run } from './run.js';

const argv = process.argv.slice(2);
const result = run(argv, readsStdin(argv) ? readFileSync(0, 'utf8') : '');
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
