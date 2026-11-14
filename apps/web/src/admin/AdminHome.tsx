import { Navigate } from 'react-router';

import { useSession } from '../auth/session';
import { canOpen, SECTIONS } from './sections';

/** `/admin` opens the first section that is built and that the user may use. */
export function AdminHome() {
  const user = useSession();
  const first = SECTIONS.find((section) => !section.soon && canOpen(user, section));
  if (first) return <Navigate to={first.path} replace />;
  return <p className="text-sm text-slate-700">Nothing here is available for your role yet.</p>;
}
