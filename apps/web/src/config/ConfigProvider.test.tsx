import { DEFAULT_APP_CONFIG } from '@ezd/core';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { COLORS } from '../editor/style';
import { viewportSettings } from '../editor/viewport';
import { ConfigProvider } from './ConfigProvider';
import { useConfig } from './useConfig';

const KEY = 'ezd.config.v1';

function Probe() {
  const config = useConfig();
  return (
    <p>
      properties:{String(config.panels.properties.visible)} quotes:{String(config.features.quotes)}
    </p>
  );
}

const published = (config: object) => ({ version: 1, config });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(COLORS, { wall: DEFAULT_APP_CONFIG.theme.plan.wall });
  Object.assign(viewportSettings, DEFAULT_APP_CONFIG.viewport);
});

describe('ConfigProvider', () => {
  it('serves the published configuration and keeps a copy', async () => {
    vi.spyOn(client.api, 'getConfig').mockResolvedValue(
      published({ panels: { properties: { visible: false } } }),
    );
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText(/properties:false/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).panels.properties.visible).toBe(false);
  });

  it('falls back to the defaults when the request fails', async () => {
    vi.spyOn(client.api, 'getConfig').mockRejectedValue(new client.NetworkError());
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText('properties:true quotes:true')).toBeInTheDocument();
  });

  it('opens at once with the cached configuration when the server is down', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ features: { quotes: false } }));
    vi.spyOn(client.api, 'getConfig').mockRejectedValue(new client.NetworkError());
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    // No waiting: the screen is not held back when there is a cached copy.
    expect(screen.getByText('properties:true quotes:false')).toBeInTheDocument();
    await waitFor(() => expect(client.api.getConfig).toHaveBeenCalled());
    expect(screen.getByText('properties:true quotes:false')).toBeInTheDocument();
  });

  it('ignores a stored copy that is not valid JSON and fields that are not valid', async () => {
    window.localStorage.setItem(KEY, '{nope');
    vi.spyOn(client.api, 'getConfig').mockResolvedValue(
      published({ features: { quotes: 'maybe', versions: false }, bogus: 1 }),
    );
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText('properties:true quotes:true')).toBeInTheDocument();
  });

  it('works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(client.api, 'getConfig').mockResolvedValue(published({}));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText('properties:true quotes:true')).toBeInTheDocument();
  });

  it('applies the theme and the viewport limits', async () => {
    vi.spyOn(client.api, 'getConfig').mockResolvedValue(
      published({ theme: { plan: { wall: '#112233' } }, viewport: { maxScale: 20 } }),
    );
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await screen.findByText(/properties/);
    expect(COLORS.wall).toBe('#112233');
    expect(viewportSettings.maxScale).toBe(20);
  });
});
