import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('public API', () => {
  it('exports the seed catalog', () => {
    expect(core.SEED_CATALOG.entries.length).toBeGreaterThan(0);
  });

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
      'getEntry',
      'allowedWidths',
      'defaultItemFor',
      'checkItemAgainstCatalog',
      'nearestAllowedWidth',
      'generateParts',
      'proposeCountertops',
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
