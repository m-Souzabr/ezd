import { type AppConfig, DEFAULT_APP_CONFIG } from '@ezd/core';
import { createContext, useContext } from 'react';

export const ConfigContext = createContext<AppConfig>(DEFAULT_APP_CONFIG);

/** The app configuration. Without a provider, as in a test, it is the defaults. */
export const useConfig = (): AppConfig => useContext(ConfigContext);
