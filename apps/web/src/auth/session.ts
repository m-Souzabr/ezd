import { useQuery } from '@tanstack/react-query';

import { api, type User } from '../api/client';

export const SESSION_KEY = ['session'] as const;

/** The signed-in user: undefined while it is being read, null when nobody is signed in. */
export function useSession(): User | null | undefined {
  return useQuery({ queryKey: SESSION_KEY, queryFn: api.me, staleTime: Infinity }).data;
}

/** Where to return after signing in. Only a path inside the app is accepted. */
export function nextPath(search: string, fallback = '/projects'): string {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export const loginPath = (from: string): string =>
  from === '/' ? '/login' : `/login?next=${encodeURIComponent(from)}`;

/** The pages for signing in, where a 401 is expected and leads nowhere else. */
const SIGN_IN_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];
export const isSignInPage = (pathname: string): boolean => SIGN_IN_PAGES.includes(pathname);
