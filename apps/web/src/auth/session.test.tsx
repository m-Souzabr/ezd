import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { User } from '../api/client';
import { loginPath, nextPath, SESSION_KEY } from './session';
import { RequireSession } from './SessionGate';

describe('where to go after signing in', () => {
  it('returns to the page that asked for a session', () => {
    expect(loginPath('/designs/abc?x=1')).toBe('/login?next=%2Fdesigns%2Fabc%3Fx%3D1');
    expect(nextPath('?next=%2Fdesigns%2Fabc%3Fx%3D1')).toBe('/designs/abc?x=1');
    expect(loginPath('/')).toBe('/login');
  });

  it('goes to the projects without a next, and never to another site', () => {
    expect(nextPath('')).toBe('/projects');
    expect(nextPath('?next=https%3A%2F%2Fevil.example')).toBe('/projects');
    expect(nextPath('?next=%2F%2Fevil.example')).toBe('/projects');
    expect(nextPath('?next=designs')).toBe('/projects');
  });
});

function Where() {
  const location = useLocation();
  return <p>at {location.pathname + location.search}</p>;
}

function renderAt(path: string, user: User | null | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (user !== undefined) queryClient.setQueryData(SESSION_KEY, user);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Where />} />
          <Route
            path="/projects/:id"
            element={
              <RequireSession>
                <p>the project</p>
              </RequireSession>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequireSession', () => {
  it('shows the page to a signed-in user', () => {
    renderAt('/projects/p1', { id: 1, email: 'ada@example.com', name: 'Ada', is_staff: false });
    expect(screen.getByText('the project')).toBeInTheDocument();
  });

  it('sends anyone else to the login page, to come back afterwards', () => {
    renderAt('/projects/p1?tab=2', null);
    expect(screen.getByText('at /login?next=%2Fprojects%2Fp1%3Ftab%3D2')).toBeInTheDocument();
  });
});
