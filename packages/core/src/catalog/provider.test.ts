import { describe, expect, it } from 'vitest';

import { err } from '../result.js';
import { type CatalogProvider, firstAvailable, seedCatalogProvider } from './provider.js';
import { SEED_CATALOG } from './seed.js';

const failing: CatalogProvider = { id: 'vendor', load: () => Promise.resolve(err('offline')) };

describe('catalog providers', () => {
  it('load the seed catalog', async () => {
    expect(await seedCatalogProvider.load()).toEqual({ ok: true, value: SEED_CATALOG });
  });

  it('fall back to the next provider, and say why none loaded', async () => {
    const chain = firstAvailable([failing, seedCatalogProvider]);
    expect(chain.id).toBe('vendor|seed');
    expect(await chain.load()).toEqual({ ok: true, value: SEED_CATALOG });
    expect(await firstAvailable([failing]).load()).toEqual({
      ok: false,
      error: 'vendor: offline',
    });
    expect(await firstAvailable([]).load()).toEqual({ ok: false, error: 'No catalog provider.' });
  });
});
