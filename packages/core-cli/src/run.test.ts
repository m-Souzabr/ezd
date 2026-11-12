import { readFileSync } from 'node:fs';

import { VERSION } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { readsStdin, run } from './run.js';

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

  it('reads stdin for validate-document only', () => {
    expect(readsStdin(['validate-document'])).toBe(true);
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
