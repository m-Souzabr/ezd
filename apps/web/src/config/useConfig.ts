import {
  type AppConfig,
  DEFAULT_APP_CONFIG,
  DEFAULT_QUOTE_DEFAULTS,
  DEFAULT_RULES_CONFIG,
  type QuoteDefaults,
  type RulesConfig,
} from '@ezd/core';
import { createContext, useContext } from 'react';

export const ConfigContext = createContext<AppConfig>(DEFAULT_APP_CONFIG);
export const RulesContext = createContext<RulesConfig>(DEFAULT_RULES_CONFIG);
export const QuoteDefaultsContext = createContext<QuoteDefaults>(DEFAULT_QUOTE_DEFAULTS);

/** The app configuration. Without a provider, as in a test, it is the defaults. */
export const useConfig = (): AppConfig => useContext(ConfigContext);

/** The design rules' configuration: severities, thresholds and snap options. */
export const useRulesConfig = (): RulesConfig => useContext(RulesContext);

/** The rates a new quote starts from. Its branding is kept by the server, not read here. */
export const useQuoteDefaults = (): QuoteDefaults => useContext(QuoteDefaultsContext);
