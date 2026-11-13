import type { ReactNode } from 'react';

import { useCan } from './can';

/**
 * Shows its children only to a user who holds the permission. This is cosmetic: the
 * server refuses the request whoever asks.
 */
export function RequirePermission({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? children : fallback;
}
