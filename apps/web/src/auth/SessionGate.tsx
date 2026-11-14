import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { setUnauthorizedHandler } from '../api/client';
import { isSignInPage, loginPath, SESSION_KEY, useSession } from './session';

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
        // A request that was in flight when the user signed out answers 401 after the
        // login page is already showing: stay there, without `next=/login`.
        if (!isSignInPage(location.pathname)) void navigate(loginPath(here), { replace: true });
      }),
    [navigate, queryClient, here, location.pathname],
  );
  return null;
}

/** Shows its children to a signed-in user, and the login page to anyone else. */
export function RequireSession({ children }: { children: ReactNode }) {
  const user = useSession();
  const location = useLocation();
  if (user === undefined) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (user === null) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  return children;
}
