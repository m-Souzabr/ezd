import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { useSession } from './session';

/** Shows its children to staff, and sends anyone else back to the editor. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const user = useSession();
  if (user === undefined) return null;
  if (!user?.is_staff) return <Navigate to="/" replace />;
  return children;
}
