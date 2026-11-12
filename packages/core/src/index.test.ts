import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('public API', () => {
  it('has a semver version', () => {
    expect(core.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports each module', () => {
    for (const name of [
      'inches',
      'parseLength',
      'formatLength',
      'createEmptyDocument',
      'parseDocument',
      'migrate',
      'wallLength',
      'itemFootprint',
      'applyCommand',
      'execute',
      'undo',
      'redo',
      'designDocumentJsonSchema',
      'commandsJsonSchema',
    ] as const) {
      expect(core[name]).toBeTypeOf('function');
    }
  });
});
