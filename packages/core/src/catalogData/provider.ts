import type { CatalogProvider } from '../catalog/index.js';
import { err } from '../result.js';
import { parseCatalog } from './validate.js';

/**
 * A provider for a catalog that arrives as JSON, such as the published one the API serves.
 * `source` may fetch it; anything it throws or returns that is not a valid catalog is an
 * error, so `firstAvailable` can fall back to the seed.
 */
export function jsonCatalogProvider(id: string, source: () => unknown): CatalogProvider {
  return {
    id,
    async load() {
      let json: unknown;
      try {
        json = await source();
      } catch (error) {
        return err(error instanceof Error ? error.message : 'The catalog could not be read.');
      }
      const parsed = parseCatalog(json);
      if (parsed.ok) return parsed;
      const [first] = parsed.error;
      const more = parsed.error.length - 1;
      return err(`${first!.path}: ${first!.message}${more > 0 ? ` (and ${more} more)` : ''}`);
    },
  };
}
