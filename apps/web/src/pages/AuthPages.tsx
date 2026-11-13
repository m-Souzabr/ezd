import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';

import { useConfig } from '../config/useConfig';
import { api, type User } from '../api/client';
import { nextPath, SESSION_KEY, useSession } from '../auth/session';
import { fieldErrors } from './format';
import { FormError, LINK, Page, PRIMARY, TextField } from './ui';

/** After signing in or registering: remember the user and go where they were headed. */
function useEnter() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  return (user: User) => {
    queryClient.clear();
    queryClient.setQueryData(SESSION_KEY, user);
    void navigate(nextPath(search), { replace: true });
  };
}

/** The login and register pages are for visitors; a signed-in user goes on. */
function useAlreadySignedIn(): string | null {
  const user = useSession();
  const { search } = useLocation();
  return user ? nextPath(search) : null;
}

export function LoginPage() {
  const registrationOpen = useConfig().features.registrationOpen;
  const enter = useEnter();
  const { search } = useLocation();
  const signedIn = useAlreadySignedIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: api.login, onSuccess: enter });

  if (signedIn && !login.isSuccess) return <Navigate to={signedIn} replace />;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };
  return (
    <Page title="Sign in" narrow>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-5 shadow-sm">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          errors={fieldErrors(login.error, 'email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          errors={fieldErrors(login.error, 'password')}
        />
        <FormError error={login.error} fields={['email', 'password']} />
        <button type="submit" className={PRIMARY} disabled={login.isPending}>
          Sign in
        </button>
      </form>
      <p className="mt-4 flex justify-between text-sm">
        {registrationOpen ? (
          <Link to={`/register${search}`} className={LINK}>
            Create an account
          </Link>
        ) : (
          <span />
        )}
        <Link to="/forgot-password" className={LINK}>
          Forgot password?
        </Link>
      </p>
    </Page>
  );
}

export function RegisterPage() {
  const enter = useEnter();
  const { search } = useLocation();
  const signedIn = useAlreadySignedIn();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const registrationOpen = useConfig().features.registrationOpen;
  const register = useMutation({ mutationFn: api.register, onSuccess: enter });

  if (signedIn && !register.isSuccess) return <Navigate to={signedIn} replace />;
  if (!registrationOpen) {
    return (
      <Page title="Create an account" narrow>
        <p className="rounded-lg bg-white p-5 text-sm text-slate-700 shadow-sm">
          Registration is closed.{' '}
          <Link to="/login" className={LINK}>
            Sign in
          </Link>
        </p>
      </Page>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    register.mutate({ name, email, password });
  };
  return (
    <Page title="Create an account" narrow>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-5 shadow-sm">
        <TextField
          label="Name"
          autoComplete="name"
          value={name}
          onChange={setName}
          required={false}
          errors={fieldErrors(register.error, 'name')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          errors={fieldErrors(register.error, 'email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          errors={fieldErrors(register.error, 'password')}
        />
        <FormError error={register.error} fields={['name', 'email', 'password']} />
        <button type="submit" className={PRIMARY} disabled={register.isPending}>
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link to={`/login${search}`} className={LINK}>
          Sign in
        </Link>
      </p>
    </Page>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const reset = useMutation({ mutationFn: api.requestPasswordReset });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    reset.mutate({ email });
  };
  return (
    <Page title="Forgot password" narrow>
      {reset.isSuccess ? (
        <p role="status" className="rounded-lg bg-white p-5 text-sm shadow-sm">
          If an account exists for {email}, an email with a link to choose a new password is on its
          way.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-600">
            Enter the email of your account and we will send a link to choose a new password.
          </p>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            errors={fieldErrors(reset.error, 'email')}
          />
          <FormError error={reset.error} fields={['email']} />
          <button type="submit" className={PRIMARY} disabled={reset.isPending}>
            Send the link
          </button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/login" className={LINK}>
          Back to sign in
        </Link>
      </p>
    </Page>
  );
}

/** Where the link in the password reset email leads. */
export function ResetPasswordPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const uid = params.get('uid') ?? '';
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const confirm = useMutation({ mutationFn: api.confirmPasswordReset });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    confirm.mutate({ uid, token, password });
  };
  return (
    <Page title="Choose a new password" narrow>
      {confirm.isSuccess ? (
        <p role="status" className="rounded-lg bg-white p-5 text-sm shadow-sm">
          Your password was changed.{' '}
          <Link to="/login" className={LINK}>
            Sign in
          </Link>
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-5 shadow-sm">
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            errors={[
              ...fieldErrors(confirm.error, 'password'),
              ...fieldErrors(confirm.error, 'token'),
              ...fieldErrors(confirm.error, 'uid'),
            ]}
          />
          <FormError error={confirm.error} fields={['password', 'token', 'uid']} />
          <button type="submit" className={PRIMARY} disabled={confirm.isPending}>
            Change password
          </button>
        </form>
      )}
    </Page>
  );
}
