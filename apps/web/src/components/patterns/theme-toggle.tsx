import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useContext } from 'react';

import { Button } from '@/components/ui/button';
import { ThemeContext, type Theme } from '@/lib/theme-context';

const NEXT: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABEL: Record<Theme, string> = {
  light: 'Theme: light. Switch to dark',
  dark: 'Theme: dark. Switch to system',
  system: 'Theme: system. Switch to light',
};

/** Without a `ThemeProvider` (a tree rendered on its own in a test) there is no theme to switch. */
export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (context === null) return null;
  const { theme, setTheme } = context;
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={LABEL[theme]}
      onClick={() => setTheme(NEXT[theme])}
    >
      <Icon className="size-5" aria-hidden="true" />
    </Button>
  );
}
