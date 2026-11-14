import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../api/client';
import { useSession } from '../auth/session';
import { useSignOut } from '../auth/useSignOut';
import { BUTTON } from '../editor/panels/fields';
import { errorMessage } from './format';

// What the Control Panel and the editor's own pages still share: the page frame, a form field and
// buttons. The account pages use the patterns in components/patterns instead; Phases 19 and 20
// move the rest, and this file goes with them.

export const PRIMARY =
  'inline-flex items-center justify-center rounded border border-sky-700 bg-sky-700 px-3 py-1.5 ' +
  'text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
export const LINK =
  'text-sky-700 underline underline-offset-2 hover:text-sky-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
const INPUT =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500';

/** The links at the right of a header: the account when signed in, or the way in. */
export function AccountLinks() {
  const user = useSession();
  const signOut = useSignOut();
  if (user === undefined) return null;
  if (user === null) {
    return (
      <nav aria-label="Account" className="ml-auto flex items-center gap-3 text-sm">
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
    <nav aria-label="Account" className="ml-auto flex items-center gap-3 text-sm">
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
      <span className="text-slate-600">{user.email}</span>
      <button type="button" className={BUTTON} onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}

/** A page outside the editor: the header, then the content in a centred column. */
export function Page({
  title,
  narrow = false,
  children,
}: {
  title: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/" className="text-base font-semibold tracking-tight">
          EZDesign
        </Link>
        <AccountLinks />
      </header>
      <main className={`mx-auto px-4 py-8 ${narrow ? 'max-w-sm' : 'max-w-3xl'}`}>
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  errors = [],
  required = true,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  errors?: string[];
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={INPUT}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors.length > 0 && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-700">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}

/** A failed request, said once for the whole form. Field errors go under their fields. */
export function FormError({ error, fields = [] }: { error: unknown; fields?: string[] }) {
  if (!error) return null;
  if (error instanceof ApiError && fields.some((name) => error.field(name).length > 0)) {
    return null;
  }
  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {errorMessage(error)}
    </p>
  );
}

/** A button that asks once more before it does something that cannot be undone here. */
export function ConfirmButton({
  label,
  what,
  onConfirm,
}: {
  label: string;
  what: string;
  onConfirm(): void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={BUTTON} onClick={() => setAsking(true)}>
        {label}
        <span className="sr-only"> {what}</span>
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1 text-sm">
      <button
        type="button"
        className={`${BUTTON} border-red-300 text-red-800`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Confirm {label.toLowerCase()}
        <span className="sr-only"> {what}</span>
      </button>
      <button type="button" className={BUTTON} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
