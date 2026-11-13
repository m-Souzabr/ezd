import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from '@/components/patterns/theme-toggle';
import { ThemeProvider } from '@/components/theme-provider';
import { useMediaQuery } from '@/hooks/use-media-query';

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cycles system, light, dark and stores the choice', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: /theme: system/i }));
    expect(localStorage.getItem('app-theme')).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: /theme: light/i }));
    expect(localStorage.getItem('app-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: /theme: dark/i }));
    expect(localStorage.getItem('app-theme')).toBe('system');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('starts from the stored theme', () => {
    localStorage.setItem('app-theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('button', { name: /theme: dark/i })).toBeInTheDocument();
  });

  it('does not throw when storage fails', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', broken);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: /theme: system/i }));
    expect(screen.getByRole('button', { name: /theme: light/i })).toBeInTheDocument();
  });
});

describe('useMediaQuery', () => {
  it('follows a changing matchMedia', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return matches;
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      })),
    );

    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 48rem)'));
    expect(result.current).toBe(false);

    matches = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current).toBe(true);

    unmount();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
});
