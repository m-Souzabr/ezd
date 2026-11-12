import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { setUnauthorizedHandler } from '../api/client';
import { loginPath, SESSION_KEY, useSession } from './session';

/**
 * Sends the user to the login page when a request finds the session has ended, and
 * comes back to the same page afterwards.
 */
export function SessionExpiry() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const here = location.pathname + location.search;

  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        queryClient.setQueryData(SESSION_KEY, null);
        void navigate(loginPath(here), { replace: true });
      }),
    [navigate, queryClient, here],
  );
  return null;
}

/** Shows its children to a signed-in user, and the login page to anyone else. */
export function RequireSession({ children }: { children: ReactNode }) {
  const user = useSession();
  const location = useLocation();
  if (user === undefined) {
    return (
      <p role="status" className="p-6 text-sm text-slate-600">
        Loading…
      </p>
    );
  }
  if (user === null) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  return children;
}
