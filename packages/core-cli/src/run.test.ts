import { VERSION } from '@ezd/core';
import { describe, expect, it } from 'vitest';

import { run } from './run.js';

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
});
