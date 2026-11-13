import {
  type AppConfig,
  DEFAULT_APP_CONFIG,
  DEFAULT_QUOTE_DEFAULTS,
  DEFAULT_RULES_CONFIG,
  parseAppConfig,
  parseQuoteDefaults,
  parseRulesConfig,
  type QuoteDefaults,
  type RulesConfig,
} from '@ezd/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { applyTheme } from '../editor/style';
import { applyViewportConfig } from '../editor/viewport';
import { ConfigContext, QuoteDefaultsContext, RulesContext } from './useConfig';

const STORAGE_KEY = 'ezd.config.v1';
const RULES_STORE = 'ezd.rules.v1';
const QUOTE_STORE = 'ezd.quote-defaults.v1';
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

/** A section kept under `key`, read as the app reads it from the server. */
function readSection<T>(
  key: string,
  parse: (input: unknown) => { ok: true; value: { config: T } } | { ok: false },
): T | null {
  try {
    const text = window.localStorage.getItem(key);
    if (!text) return null;
    const parsed = parse(JSON.parse(text));
    return parsed.ok ? parsed.value.config : null;
  } catch {
    return null;
  }
}

function writeCached(config: object, key = STORAGE_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(config));
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
  const [rules, setRules] = useState<RulesConfig>(
    () => readSection(RULES_STORE, parseRulesConfig) ?? DEFAULT_RULES_CONFIG,
  );
  const [quoteDefaults, setQuoteDefaults] = useState<QuoteDefaults>(
    () => readSection(QUOTE_STORE, parseQuoteDefaults) ?? DEFAULT_QUOTE_DEFAULTS,
  );
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
        // Each section is replaced only when it is not what is already in force, so a
        // design that is open does not start again over a configuration that did not change.
        const nextRules = parseRulesConfig(published.rules_config);
        if (nextRules.ok) {
          setRules((current) =>
            JSON.stringify(current) === JSON.stringify(nextRules.value.config)
              ? current
              : nextRules.value.config,
          );
          writeCached(nextRules.value.config, RULES_STORE);
        }
        const nextQuote = parseQuoteDefaults(published.quote_defaults);
        if (nextQuote.ok) {
          setQuoteDefaults((current) =>
            JSON.stringify(current) === JSON.stringify(nextQuote.value.config)
              ? current
              : nextQuote.value.config,
          );
          writeCached(nextQuote.value.config, QUOTE_STORE);
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
  return (
    <ConfigContext.Provider value={value}>
      <RulesContext.Provider value={rules}>
        <QuoteDefaultsContext.Provider value={quoteDefaults}>
          {children}
        </QuoteDefaultsContext.Provider>
      </RulesContext.Provider>
    </ConfigContext.Provider>
  );
}
