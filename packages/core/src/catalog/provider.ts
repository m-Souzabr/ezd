import { err, ok, type Result } from '../result.js';
import { SEED_CATALOG } from './seed.js';
import type { Catalog } from './types.js';

/**
 * Where a catalog comes from. v1 has one provider, the seed catalog; a manufacturer's
 * catalog would be another (see docs/EXTENDING.md). `version` changes whenever entries,
 * sizes or prices change, and a stored quote keeps the version it was priced with.
 */
export interface CatalogProvider {
  /** Stable, for example `seed` or `acme-2027`. */
  readonly id: string;
  /** The catalog, or why it could not be loaded. */
  load(): Promise<Result<Catalog, string>>;
}

export const seedCatalogProvider: CatalogProvider = {
  id: 'seed',
  load: () => Promise.resolve(ok(SEED_CATALOG)),
};

/** The first provider that loads, in order: a vendor's catalog, then the seed one. */
export function firstAvailable(providers: readonly CatalogProvider[]): CatalogProvider {
  return {
    id: providers.map((provider) => provider.id).join('|'),
    async load() {
      const reasons: string[] = [];
      for (const provider of providers) {
        const loaded = await provider.load();
        if (loaded.ok) return loaded;
        reasons.push(`${provider.id}: ${loaded.error}`);
      }
      return err(reasons.length > 0 ? reasons.join('; ') : 'No catalog provider.');
    },
  };
}
