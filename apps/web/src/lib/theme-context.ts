import { createContext } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const THEME_STORAGE_KEY = 'app-theme';

export const ThemeContext = createContext<ThemeContextValue | null>(null);
