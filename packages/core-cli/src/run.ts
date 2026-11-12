import { VERSION as CORE_VERSION, type Issue, parseDocument } from '@ezd/core';

import pkg from '../package.json' with { type: 'json' };

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const USAGE = `Usage: ezd-core [options] [command]

Commands:
  validate-document  read a design document as JSON on stdin and print { ok, errors };
                     exits 0 when it is valid and 1 when it is not

Options:
  -V, --version  print the CLI and core versions
  -h, --help     print this help
`;

/** Whether the CLI must read stdin before calling `run` with these arguments. */
export const readsStdin = (argv: readonly string[]): boolean => argv[0] === 'validate-document';

function validateDocument(stdin: string): CliResult {
  let errors: Issue[];
  try {
    const parsed = parseDocument(JSON.parse(stdin));
    errors = parsed.ok ? [] : parsed.error.issues;
  } catch (error) {
    errors = [{ path: '', message: `Invalid JSON: ${(error as Error).message}` }];
  }
  const ok = errors.length === 0;
  return { exitCode: ok ? 0 : 1, stdout: `${JSON.stringify({ ok, errors })}\n`, stderr: '' };
}

/** Runs the CLI for the given arguments (without `node` and the script path). */
export function run(argv: readonly string[], stdin = ''): CliResult {
  const [first] = argv;

  if (first === 'validate-document') return validateDocument(stdin);
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
