import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { FolderIcon, HouseIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { User } from '@/api/client';
import { ThemeProvider } from '@/components/theme-provider';
import { SESSION_KEY } from '@/auth/session';
import { AppShell } from '@/components/patterns/app-shell';
import type { NavItem } from '@/lib/navigation';
import { isActivePath, MAX_BOTTOM_ITEMS, visibleNavItems } from '@/lib/navigation';

const ITEMS: NavItem[] = [
  { to: '/', label: 'Editor', icon: HouseIcon },
  { to: '/projects', label: 'Projects', icon: FolderIcon },
  { to: '/admin', label: 'Admin', icon: ShieldIcon, staffOnly: true },
  { to: '/admin/users', label: 'Users', icon: UsersIcon, permission: 'users.view' },
];

const user = (overrides: Partial<User> = {}): User =>
  ({
    id: 1,
    email: 'ana@example.com',
    is_staff: false,
    is_superuser: false,
    permissions: [],
    ...overrides,
  }) as User;

function renderShell(path: string, session: User | null, items = ITEMS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(SESSION_KEY, session);
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell items={items} />}>
              <Route path="*" element={<p>Page body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const labelsIn = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('AppShell', () => {
  it('marks the active item in the bottom bar and the sidebar', () => {
    renderShell('/projects/7', user());
    const bar = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(bar).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(bar).getByRole('link', { name: 'Editor' })).not.toHaveAttribute('aria-current');
    const sidebarLink = screen
      .getAllByRole('link', { name: 'Projects' })
      .find((link) => link.closest('[data-sidebar="menu-item"]'));
    expect(
      sidebarLink?.closest('[data-sidebar="menu-item"]')?.querySelector('[data-active]'),
    ).not.toBeNull();
  });

  it('shows only the items the user may see', () => {
    renderShell('/', user());
    expect(labelsIn(screen.getByRole('navigation', { name: 'Primary' }))).toEqual([
      'Editor',
      'Projects',
    ]);
  });

  it('shows staff-only items to staff and permissioned items to holders', () => {
    renderShell('/', user({ is_staff: true, permissions: ['users.view'] }));
    expect(labelsIn(screen.getByRole('navigation', { name: 'Primary' }))).toEqual([
      'Editor',
      'Projects',
      'Admin',
      'Users',
    ]);
  });

  it('shows a superuser every permissioned item', () => {
    renderShell('/', user({ is_staff: true, is_superuser: true }));
    expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveTextContent('Users');
  });

  it('hides restricted items from someone signed out, and offers the way in', () => {
    renderShell('/', null);
    expect(labelsIn(screen.getByRole('navigation', { name: 'Primary' }))).toEqual([
      'Editor',
      'Projects',
    ]);
    const account = screen.getByRole('navigation', { name: 'Account' });
    expect(within(account).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(within(account).getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('has the account and sign out in the sidebar footer', () => {
    renderShell('/', user());
    const account = screen.getByRole('navigation', { name: 'Account' });
    expect(within(account).getByText('ana@example.com')).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows at most five items in the bottom bar', () => {
    const many: NavItem[] = Array.from({ length: 7 }, (_, i) => ({
      to: `/p${i}`,
      label: `Item ${i}`,
      icon: FolderIcon,
    }));
    renderShell('/', user(), many);
    expect(MAX_BOTTOM_ITEMS).toBe(5);
    expect(
      within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link'),
    ).toHaveLength(5);
  });

  it('renders the page in the main landmark', () => {
    renderShell('/', user());
    expect(within(screen.getByRole('main')).getByText('Page body')).toBeInTheDocument();
  });
});

describe('navigation helpers', () => {
  it('matches a path by segment, and `/` only itself', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/projects', '/')).toBe(false);
    expect(isActivePath('/projects/7', '/projects')).toBe(true);
    expect(isActivePath('/projects-old', '/projects')).toBe(false);
  });

  it('filters for an unknown session as for a signed-out one', () => {
    expect(visibleNavItems(ITEMS, undefined).map((item) => item.label)).toEqual([
      'Editor',
      'Projects',
    ]);
  });
});
