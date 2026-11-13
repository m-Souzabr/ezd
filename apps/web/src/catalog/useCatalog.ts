import { type Catalog, SEED_CATALOG } from '@ezd/core';
import { createContext, useContext } from 'react';

export const CatalogContext = createContext<Catalog>(SEED_CATALOG);

/** The published catalog. Without a provider, as in a test, it is the seed catalog. */
export const useCatalog = (): Catalog => useContext(CatalogContext);
