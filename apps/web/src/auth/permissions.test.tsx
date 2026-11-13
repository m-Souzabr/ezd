import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { User } from '../api/client';
import { makeUser } from '../test/users';
import { userCan } from './can';
import { RequirePermission } from './permissions';
import { RequireStaff } from './RequireStaff';
import { SESSION_KEY } from './session';

function withSession(user: User | null, ui: ReactNode, path = '/admin') {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SESSION_KEY, user);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>the editor</p>} />
          <Route path="/admin" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('userCan', () => {
  it('is true for a held permission only', () => {
    const user = makeUser({ permissions: ['users.view'] });
    expect(userCan(user, 'users.view')).toBe(true);
    expect(userCan(user, 'users.manage')).toBe(false);
  });

  it('is true for everything for a superuser, and false with no user', () => {
    expect(userCan(makeUser({ is_superuser: true }), 'audit.view')).toBe(true);
    expect(userCan(null, 'audit.view')).toBe(false);
    expect(userCan(undefined, 'audit.view')).toBe(false);
  });
});

describe('RequirePermission', () => {
  it('shows its children to a user who holds the permission', () => {
    withSession(
      makeUser({ permissions: ['users.view'] }),
      <RequirePermission permission="users.view">secret</RequirePermission>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('shows the fallback, or nothing, to anyone else', () => {
    withSession(
      makeUser(),
      <>
        <RequirePermission permission="users.view" fallback={<p>no access</p>}>
          secret
        </RequirePermission>
        <RequirePermission permission="users.view">also secret</RequirePermission>
      </>,
    );
    expect(screen.getByText('no access')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });
});

describe('RequireStaff', () => {
  it('lets staff in', () => {
    withSession(makeUser(), <RequireStaff>inside</RequireStaff>);
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('sends a user who is not staff to the editor', () => {
    withSession(makeUser({ is_staff: false }), <RequireStaff>inside</RequireStaff>);
    expect(screen.getByText('the editor')).toBeInTheDocument();
    expect(screen.queryByText('inside')).not.toBeInTheDocument();
  });
});
