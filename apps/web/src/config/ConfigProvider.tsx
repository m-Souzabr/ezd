import { type AppConfig, DEFAULT_APP_CONFIG, parseAppConfig } from '@ezd/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { applyTheme } from '../editor/style';
import { applyViewportConfig } from '../editor/viewport';
import { ConfigContext } from './useConfig';

const STORAGE_KEY = 'ezd.config.v1';
/** How long a first visit waits for the server before it opens with the defaults. */
const FIRST_LOAD_WAIT_MS = 2000;

function readCached(): AppConfig | null {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = parseAppConfig(JSON.parse(text));
    return parsed.ok ? parsed.value.config : null;
  } catch {
    return null;
  }
}

function writeCached(config: object): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Private windows and full storage: the next visit asks the server again.
  }
}

/** Applies what is not React state: the colours and the viewport limits. */
function apply(config: AppConfig): AppConfig {
  applyTheme(config.theme);
  applyViewportConfig(config.viewport);
  return config;
}

/**
 * Fetches the published configuration once and offers it through `useConfig`. The last one
 * received is kept in `localStorage`, so a return visit opens at once with it. If the
 * server cannot be reached the cached one, or else the defaults, stay in force: the editor
 * at `/` never needs the API.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [cached] = useState(readCached);
  const [config, setConfig] = useState<AppConfig>(() => apply(cached ?? DEFAULT_APP_CONFIG));
  // A first visit holds the screen briefly, so what the server hides is never flashed.
  const [settled, setSettled] = useState(cached !== null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => setSettled(true), FIRST_LOAD_WAIT_MS);
    api.getConfig().then(
      (published) => {
        if (cancelled) return;
        const parsed = parseAppConfig(published.config);
        if (parsed.ok) {
          setConfig(apply(parsed.value.config));
          writeCached(published.config as object);
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

  const value = useMemo(() => config, [config]);
  if (!settled) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        <h1 className="sr-only">EZDesign</h1>
        <p role="status">Loading…</p>
      </main>
    );
  }
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}
