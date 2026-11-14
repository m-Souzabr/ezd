import { type Catalog, parseCatalog, SEED_CATALOG } from '@ezd/core';
import { type ReactNode, useEffect, useState } from 'react';

import { api } from '../api/client';
import { CatalogContext } from './useCatalog';

const STORAGE_KEY = 'ezd.catalog.v1';
/** How long a first visit waits for the server before it opens with the seed catalog. */
const FIRST_LOAD_WAIT_MS = 2000;

function readCached(): Catalog | null {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = parseCatalog(JSON.parse(text));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

function writeCached(catalog: Catalog): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // Private windows and full storage: the next visit asks the server again.
  }
}

/**
 * Fetches the published catalog once and offers it through `useCatalog`. A catalog that
 * does not pass core's checks is ignored. The last good one is kept in `localStorage`, so a
 * return visit opens at once with it; if the server cannot be reached that one, or else the
 * compiled-in seed catalog, stays in force: the editor at `/` never needs the API.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [cached] = useState(readCached);
  const [catalog, setCatalog] = useState<Catalog>(cached ?? SEED_CATALOG);
  // A first visit holds the screen briefly, so a design is never opened with the wrong prices.
  const [settled, setSettled] = useState(cached !== null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => setSettled(true), FIRST_LOAD_WAIT_MS);
    api.getCatalog().then(
      (published) => {
        if (cancelled) return;
        const parsed = parseCatalog(published.catalog);
        if (parsed.ok) {
          setCatalog(parsed.value);
          writeCached(parsed.value);
        }
        setSettled(true);
      },
      () => {
        if (!cancelled) setSettled(true);
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!settled) {
    return (
      <main className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <h1 className="sr-only">EZDesign</h1>
        <p role="status">Loading…</p>
      </main>
    );
  }
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}
