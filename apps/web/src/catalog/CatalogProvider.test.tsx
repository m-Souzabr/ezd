import { type Catalog, getEntry, SEED_CATALOG } from '@ezd/core';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { CatalogProvider } from './CatalogProvider';
import { useCatalog } from './useCatalog';

const KEY = 'ezd.catalog.v1';

function Probe() {
  const catalog = useCatalog();
  return (
    <p>
      {catalog.version}: {getEntry(catalog, 'base.standard')!.price.baseCents}
    </p>
  );
}

const withBasePrice = (cents: number, version: string): Catalog => ({
  ...SEED_CATALOG,
  version,
  entries: SEED_CATALOG.entries.map((entry) =>
    entry.id === 'base.standard'
      ? { ...entry, price: { ...entry.price, baseCents: cents } }
      : entry,
  ),
});

const published = (catalog: unknown) => ({ version: 'x', catalog });
const mount = () =>
  render(
    <CatalogProvider>
      <Probe />
    </CatalogProvider>,
  );

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('CatalogProvider', () => {
  it('serves the published catalog and keeps a copy', async () => {
    vi.spyOn(client.api, 'getCatalog').mockResolvedValue(
      published(withBasePrice(99900, 'catalog-2')) as never,
    );
    mount();
    expect(await screen.findByText('catalog-2: 99900')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).version).toBe('catalog-2');
  });

  it('falls back to the seed catalog when the request fails', async () => {
    vi.spyOn(client.api, 'getCatalog').mockRejectedValue(new client.NetworkError());
    mount();
    expect(await screen.findByText('seed-1: 12000')).toBeInTheDocument();
  });

  it('opens at once with the cached catalog when the server is down', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(withBasePrice(500, 'catalog-7')));
    vi.spyOn(client.api, 'getCatalog').mockRejectedValue(new client.NetworkError());
    mount();
    expect(screen.getByText('catalog-7: 500')).toBeInTheDocument();
    await waitFor(() => expect(client.api.getCatalog).toHaveBeenCalled());
    expect(screen.getByText('catalog-7: 500')).toBeInTheDocument();
  });

  it('ignores a stored copy and a published catalog that break a rule', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(withBasePrice(-1, 'broken')));
    vi.spyOn(client.api, 'getCatalog').mockResolvedValue(
      published(withBasePrice(-5, 'also-broken')) as never,
    );
    mount();
    expect(await screen.findByText('seed-1: 12000')).toBeInTheDocument();
    window.localStorage.setItem(KEY, '{nope');
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(client.api, 'getCatalog').mockResolvedValue(
      published(withBasePrice(700, 'catalog-3')) as never,
    );
    mount();
    expect(await screen.findByText('catalog-3: 700')).toBeInTheDocument();
  });
});
