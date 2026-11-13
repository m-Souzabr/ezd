import { readFileSync } from 'node:fs';

import { type Command, createEmptyDocument, inches, VERSION } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { readsStdin, run, type ValidateOutput } from './run.js';

// The fixtures core's own tests use.
const fixture = (name: string): string =>
  readFileSync(new URL(`../../core/src/document/fixtures/${name}.json`, import.meta.url), 'utf8');

describe('run', () => {
  it('prints the CLI and core versions for --version', () => {
    const result = run(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`ezd-core 0.0.0 (core ${VERSION})\n`);
  });

  it('rejects unknown arguments', () => {
    const result = run(['--nope']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown argument '--nope'");
  });

  it('reads stdin for validate-document and validate only', () => {
    expect(readsStdin(['validate-document'])).toBe(true);
    expect(readsStdin(['validate'])).toBe(true);
    expect(readsStdin(['--version'])).toBe(false);
    expect(readsStdin([])).toBe(false);
  });
});

describe('validate-document', () => {
  it('accepts the valid fixture', () => {
    const result = run(['validate-document'], fixture('valid'));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ['duplicate-id', 'items[1].id'],
    ['dangling-wall-id', 'items[2].placement.wallId'],
    ['float-length', 'items[0].width'],
    ['zero-length-wall', 'room.walls[3].end'],
  ])('rejects the %s fixture at %s', (name, path) => {
    const result = run(['validate-document'], fixture(name));
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: { path: string }[] };
    expect(output.ok).toBe(false);
    expect(output.errors.map((error) => error.path)).toEqual([path]);
  });

  it('rejects input that is not JSON', () => {
    const result = run(['validate-document'], '{ not json');
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: { message: string }[] };
    expect(output.ok).toBe(false);
    expect(output.errors[0]!.message).toMatch(/^Invalid JSON/);
  });

  it('rejects empty input', () => {
    expect(run(['validate-document']).exitCode).toBe(1);
  });
});

describe('validate', () => {
  const wall = (id: string, from: [number, number], to: [number, number]): Command => ({
    type: 'wall.add',
    wall: {
      id,
      start: { x: inches(from[0]), y: inches(from[1]) },
      end: { x: inches(to[0]), y: inches(to[1]) },
      thickness: inches(4.5),
    },
  });
  const base = (id: string, offset: number, width = 30): Command => ({
    type: 'item.add',
    item: {
      id,
      catalogId: 'base.standard',
      kind: 'base',
      width: inches(width),
      height: inches(34.5),
      depth: inches(24),
      elevation: 0,
      placement: { type: 'wall', wallId: 'wall-north', offset: inches(offset) },
      options: {},
    },
  });
  const empty = createEmptyDocument({ id: 'doc-00000001', name: 'Kitchen' });
  const room = [
    wall('wall-north', [0, 0], [144, 0]),
    wall('wall-east', [144, 0], [144, 120]),
    wall('wall-south', [144, 120], [0, 120]),
    wall('wall-west', [0, 120], [0, 0]),
  ];

  const validate = (input: unknown): { exitCode: number; output: ValidateOutput } => {
    const result = run(['validate'], typeof input === 'string' ? input : JSON.stringify(input));
    expect(result.stderr).toBe('');
    return { exitCode: result.exitCode, output: JSON.parse(result.stdout) as ValidateOutput };
  };

  it('applies the commands as one batch and reports the violations they introduce', () => {
    const { exitCode, output } = validate({
      document: empty,
      commands: [...room, base('item-0001', 0), base('item-0002', 24)],
    });
    expect(exitCode).toBe(0);
    expect(output.ok).toBe(true);
    expect(output.commandError).toBeNull();
    expect(output.errors).toEqual([]);
    expect(output.document!.room.walls).toHaveLength(4);
    expect(output.document!.items.map((item) => item.id)).toEqual(['item-0001', 'item-0002']);
    expect(output.violations.map((violation) => violation.ruleId)).toEqual([
      'item.overlap',
      'countertop.coverage',
    ]);
    expect(output.introduced).toEqual(output.violations);
    expect(output.violations[0]).toEqual({
      ruleId: 'item.overlap',
      severity: 'error',
      itemIds: ['item-0001', 'item-0002'],
      message: 'Base cabinet 30" at 0" on wall A overlaps the base cabinet 30" at 24" on wall A.',
    });
  });

  it('validates a document on its own, and introduces only what is new', () => {
    const { output: first } = validate({
      document: empty,
      commands: [...room, base('item-0001', 0)],
    });
    const alone = validate({ document: first.document });
    expect(alone.exitCode).toBe(0);
    expect(alone.output).toEqual({ ...first, introduced: [] });
    expect(validate({ document: first.document, commands: [] }).output).toEqual(alone.output);

    const next = validate({ document: first.document, commands: [base('item-0002', 24)] });
    expect(next.output.violations.map((violation) => violation.ruleId)).toEqual([
      'item.overlap',
      'countertop.coverage',
    ]);
    expect(next.output.introduced.map((violation) => violation.ruleId)).toEqual([
      'item.overlap',
      'countertop.coverage',
    ]);
    expect(next.output.introduced[1]!.itemIds).toEqual(['item-0001', 'item-0002', 'wall-north']);
  });

  it('applies nothing when a command fails, and says which one and why', () => {
    const { output: before } = validate({ document: empty, commands: room });
    const { exitCode, output } = validate({
      document: before.document,
      commands: [base('item-0001', 0), base('item-0002', 30, 31)],
    });
    expect(exitCode).toBe(1);
    expect(output.ok).toBe(false);
    expect(output.commandError).toMatchObject({
      code: 'INVALID_ARGUMENT',
      commandIndex: 1,
      constraintErrors: [{ code: 'WIDTH_OFF_STEP' }],
    });
    expect(output.document).toEqual(before.document);
    expect(output.violations).toEqual(before.violations);
    expect(output.introduced).toEqual([]);
  });

  it('rejects a command that does not match the schema', () => {
    const { exitCode, output } = validate({ document: empty, commands: [{ type: 'nope' }] });
    expect(exitCode).toBe(1);
    expect(output.commandError).toMatchObject({ code: 'SCHEMA', commandIndex: 0 });
  });

  it('rejects commands that are not an array', () => {
    const { exitCode, output } = validate({ document: empty, commands: 'nope' });
    expect(exitCode).toBe(1);
    expect(output.ok).toBe(false);
    expect(output.errors).toEqual([{ path: 'commands', message: 'Expected an array of commands' }]);
  });

  it('rejects a document that is not valid, with the path of each problem', () => {
    const { exitCode, output } = validate({ document: JSON.parse(fixture('duplicate-id')) });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ ok: false, document: null, violations: [], commandError: null });
    expect(output.errors.map((error) => error.path)).toEqual(['document.items[1].id']);
    expect(validate({}).output.errors[0]!.path).toBe('document');
    expect(validate('null').output.errors[0]!.path).toBe('document');
  });

  it('rejects input that is not JSON', () => {
    const { exitCode, output } = validate('{ not json');
    expect(exitCode).toBe(1);
    expect(output.ok).toBe(false);
    expect(output.errors[0]!.message).toMatch(/^Invalid JSON/);
  });

  it('checks the fixture kitchen against the seed catalog', () => {
    const { exitCode, output } = validate({ document: JSON.parse(fixture('valid')) });
    expect(exitCode).toBe(0);
    // Its catalog ids predate the seed catalog.
    expect(output.violations.filter((v) => v.ruleId === 'item.catalog')).toHaveLength(4);
  });
});

describe('llm-summary', () => {
  it('prints the summary and aliases of a document', () => {
    expect(readsStdin(['llm-summary'])).toBe(true);
    const result = run(['llm-summary'], JSON.stringify({ document: JSON.parse(fixture('valid')) }));
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { ok: boolean; text: string; aliases: object };
    expect(output.ok).toBe(true);
    expect(output.text).toContain('Wall A: length 120');
    expect(output.aliases).toMatchObject({ c1: 'item-base-01', o1: 'door-south' });
  });

  it('honours maxChars and rejects an invalid document', () => {
    const document = JSON.parse(fixture('valid')) as object;
    const short = JSON.parse(
      run(['llm-summary'], JSON.stringify({ document, maxChars: 200 })).stdout,
    ) as {
      text: string;
    };
    expect(short.text.length).toBeLessThanOrEqual(200);
    const bad = run(['llm-summary'], JSON.stringify({ document: {} }));
    expect(bad.exitCode).toBe(1);
    expect((JSON.parse(bad.stdout) as { errors: { path: string }[] }).errors[0]!.path).toMatch(
      /^document/,
    );
    expect(run(['llm-summary'], 'nope').exitCode).toBe(1);
  });
});

describe('llm-dry-run', () => {
  const document = () => ({
    ...createEmptyDocument({ id: 'doc-00000001', name: 'Test' }),
    room: {
      ceilingHeight: inches(96),
      walls: [
        { id: 'wall-north', start: { x: 0, y: 0 }, end: { x: inches(144), y: 0 }, thickness: 72 },
      ],
      openings: [],
    },
  });
  const addBase = (offsetIn: number) => ({
    name: 'add_item',
    arguments: { catalogId: 'base.standard', widthIn: 30, wall: 'A', offsetIn },
  });

  it('converts tool calls to one batch and returns the next document', () => {
    expect(readsStdin(['llm-dry-run'])).toBe(true);
    const result = run(
      ['llm-dry-run'],
      JSON.stringify({ document: document(), toolCalls: [addBase(0)], aliases: {} }),
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      command: Command;
      document: { items: unknown[] };
      changes: string[];
    };
    expect(output.ok).toBe(true);
    expect(output.command.type).toBe('batch');
    expect(output.document.items).toHaveLength(1);
    expect(output.changes).toEqual(['Add 30" base cabinet on wall A at 0"']);
  });

  it('returns errors worded for the model', () => {
    const result = run(
      ['llm-dry-run'],
      JSON.stringify({
        document: document(),
        toolCalls: [addBase(0), addBase(15)],
        aliases: {},
      }),
    );
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as { errors: { message: string }[]; command: null };
    expect(output.command).toBeNull();
    expect(output.errors[0]!.message).toMatch(/^The change would cause this problem/);
  });

  it('rejects bad input', () => {
    const missing = run(['llm-dry-run'], JSON.stringify({ document: document() }));
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain('Expected toolCalls');
    const invalid = run(
      ['llm-dry-run'],
      JSON.stringify({ document: {}, toolCalls: [], aliases: {} }),
    );
    expect(
      (JSON.parse(invalid.stdout) as { errors: { toolIndex: number }[] }).errors[0]!.toolIndex,
    ).toBe(-1);
    expect(run(['llm-dry-run'], '{').stdout).toContain('Invalid JSON');
  });
});
