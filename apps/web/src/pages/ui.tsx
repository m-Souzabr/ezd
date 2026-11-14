import { Link } from 'react-router';

import { useSession } from '../auth/session';
import { useSignOut } from '../auth/useSignOut';
import { Button } from '@/components/ui/button';

// What the editor's own pages still share: the header links of the quick editor and the link style.

export const LINK =
  'text-primary underline underline-offset-2 hover:text-primary/80 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
/** The links at the right of a header: the account when signed in, or the way in. */
export function AccountLinks() {
  const user = useSession();
  const signOut = useSignOut();
  if (user === undefined) return null;
  if (user === null) {
    return (
      <nav
        aria-label="Account"
        className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      >
        <Link to="/login" className={LINK}>
          Sign in
        </Link>
        <Link to="/register" className={LINK}>
          Create account
        </Link>
      </nav>
    );
  }
  return (
    <nav
      aria-label="Account"
      className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    >
      <Link to="/projects" className={LINK}>
        My projects
      </Link>
      {user.is_staff && (
        <>
          <Link to="/admin" className={LINK}>
            Admin
          </Link>
          <Link to="/admin/ai" className={LINK}>
            AI settings
          </Link>
        </>
      )}
      <span className="text-muted-foreground">{user.email}</span>
      <Button variant="outline" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </nav>
  );
}
