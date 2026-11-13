import {
  type Command,
  type CommandError,
  VERSION as CORE_VERSION,
  type DesignDocument,
  dryRunProposal,
  type Issue,
  parseDocument,
  type ProposalError,
  SEED_CATALOG,
  summarizeForLLM,
  type ToolCall,
  validate,
  validateCommand,
  type Violation,
} from '@ezd/core';

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
  validate           read { document, commands? } as JSON on stdin, apply the commands
                     as one batch if there are any, check the design rules against the
                     seed catalog and print
                     { ok, document, violations, introduced, commandError, errors };
                     ok says the input was valid and the commands applied, not that
                     the design has no violations; exits 0 when ok and 1 when not
  llm-summary        read { document, maxChars? } on stdin and print
                     { ok, text, aliases, errors }: the design as the chat model reads it
  llm-dry-run        read { document, toolCalls, aliases } on stdin, convert the tool
                     calls to one batch command and check it as the editor does; print
                     { ok, command, document, changes, warnings, errors }, where errors
                     are worded for the model; exits 0 when the proposal may be shown

Options:
  -V, --version  print the CLI and core versions
  -h, --help     print this help
`;

/** Whether the CLI must read stdin before calling `run` with these arguments. */
export const readsStdin = (argv: readonly string[]): boolean =>
  ['validate-document', 'validate', 'llm-summary', 'llm-dry-run'].includes(argv[0] ?? '');

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

/** What `validate` prints. */
export interface ValidateOutput {
  /** The input was a valid document and every command applied. */
  ok: boolean;
  /** The document after the commands, or as given if there were none or they failed. */
  document: DesignDocument | null;
  /** Every violation of `document`, sorted. */
  violations: Violation[];
  /** The violations the commands added. Empty without commands. */
  introduced: Violation[];
  /** Why the commands did not apply, or null. */
  commandError: CommandError | null;
  /** What is wrong with the input itself: not JSON, or not a valid document. */
  errors: Issue[];
}

function validateDesign(stdin: string): CliResult {
  const output: ValidateOutput = {
    ok: false,
    document: null,
    violations: [],
    introduced: [],
    commandError: null,
    errors: [],
  };
  const done = (): CliResult => ({
    exitCode: output.ok ? 0 : 1,
    stdout: `${JSON.stringify(output)}\n`,
    stderr: '',
  });

  let input: { document?: unknown; commands?: unknown };
  try {
    input = JSON.parse(stdin) as typeof input;
  } catch (error) {
    output.errors = [{ path: '', message: `Invalid JSON: ${(error as Error).message}` }];
    return done();
  }
  const parsed = parseDocument(input?.document);
  if (!parsed.ok) {
    output.errors = parsed.error.issues.map((issue) => ({
      ...issue,
      path: issue.path === '' ? 'document' : `document.${issue.path}`,
    }));
    return done();
  }
  output.document = parsed.value;

  const commands = input.commands ?? [];
  if (!Array.isArray(commands) || commands.length === 0) {
    output.ok = Array.isArray(commands);
    if (!output.ok)
      output.errors = [{ path: 'commands', message: 'Expected an array of commands' }];
    output.violations = validate(parsed.value, SEED_CATALOG);
    return done();
  }
  // `applyCommand` checks the batch against the command schema, so the cast is safe.
  const batch = { type: 'batch', commands } as Command;
  const result = validateCommand(parsed.value, SEED_CATALOG, batch);
  if (result.ok) {
    output.ok = true;
    output.document = result.value.doc;
    output.violations = result.value.violations;
    output.introduced = result.value.introduced;
  } else {
    output.commandError = result.error;
    output.violations = validate(parsed.value, SEED_CATALOG);
  }
  return done();
}

type Input = Record<string, unknown>;

/** The JSON object on stdin with its `document` parsed, or the issues that stop it. */
function readDocumentInput(
  stdin: string,
): { ok: true; input: Input; document: DesignDocument } | { ok: false; errors: Issue[] } {
  let input: Input;
  try {
    input = JSON.parse(stdin) as Input;
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: '', message: `Invalid JSON: ${(error as Error).message}` }],
    };
  }
  const parsed = parseDocument(input?.document);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        ...issue,
        path: issue.path === '' ? 'document' : `document.${issue.path}`,
      })),
    };
  }
  return { ok: true, input, document: parsed.value };
}

const printed = (ok: boolean, output: object): CliResult => ({
  exitCode: ok ? 0 : 1,
  stdout: `${JSON.stringify({ ...output, ok })}\n`,
  stderr: '',
});

function llmSummary(stdin: string): CliResult {
  const read = readDocumentInput(stdin);
  if (!read.ok) return printed(false, { text: '', aliases: {}, errors: read.errors });
  const { maxChars } = read.input;
  const summary = summarizeForLLM(
    read.document,
    SEED_CATALOG,
    validate(read.document, SEED_CATALOG),
    typeof maxChars === 'number' ? { maxChars } : {},
  );
  return printed(true, { ...summary, errors: [] });
}

/** What `llm-dry-run` prints. */
export interface DryRunOutput {
  ok: boolean;
  command: Command | null;
  /** The document after the proposal, or null when it fails. */
  document: DesignDocument | null;
  changes: string[];
  warnings: Violation[];
  /** For the model: why the proposal cannot be shown. Input problems have `toolIndex` -1. */
  errors: ProposalError[];
}

function llmDryRun(stdin: string): CliResult {
  const output: DryRunOutput = {
    ok: false,
    command: null,
    document: null,
    changes: [],
    warnings: [],
    errors: [],
  };
  const read = readDocumentInput(stdin);
  if (!read.ok) {
    output.errors = read.errors.map((issue) => ({
      toolIndex: -1,
      tool: '',
      message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
    }));
    return printed(false, output);
  }
  const { toolCalls, aliases } = read.input;
  if (!Array.isArray(toolCalls) || typeof aliases !== 'object' || aliases === null) {
    output.errors = [
      {
        toolIndex: -1,
        tool: '',
        message: 'Expected toolCalls as an array and aliases as an object',
      },
    ];
    return printed(false, output);
  }
  const run = dryRunProposal(
    toolCalls as ToolCall[],
    aliases as Record<string, string>,
    read.document,
    SEED_CATALOG,
  );
  if (!run.ok) return printed(false, { ...output, errors: run.errors });
  return printed(true, {
    ...output,
    command: run.command,
    document: run.doc,
    changes: run.changes,
    warnings: run.introducedWarnings,
  });
}

/** Runs the CLI for the given arguments (without `node` and the script path). */
export function run(argv: readonly string[], stdin = ''): CliResult {
  const [first] = argv;

  if (first === 'validate-document') return validateDocument(stdin);
  if (first === 'validate') return validateDesign(stdin);
  if (first === 'llm-summary') return llmSummary(stdin);
  if (first === 'llm-dry-run') return llmDryRun(stdin);
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
