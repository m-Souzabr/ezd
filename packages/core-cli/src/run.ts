import { VERSION as CORE_VERSION } from '@ezd/core';

import pkg from '../package.json' with { type: 'json' };

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const USAGE = `Usage: ezd-core [options]

Options:
  -V, --version  print the CLI and core versions
  -h, --help     print this help
`;

/** Runs the CLI for the given arguments (without `node` and the script path). */
export function run(argv: readonly string[]): CliResult {
  const [first] = argv;

  if (first === '--version' || first === '-V') {
    return {
      exitCode: 0,
      stdout: `ezd-core ${pkg.version} (core ${CORE_VERSION})\n`,
      stderr: '',
    };
  }
  if (first === undefined || first === '--help' || first === '-h') {
    return { exitCode: 0, stdout: USAGE, stderr: '' };
  }
  return { exitCode: 2, stdout: '', stderr: `ezd-core: unknown argument '${first}'\n\n${USAGE}` };
}
