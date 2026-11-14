import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { api, type User } from '@/api/client';
import { nextPath, SESSION_KEY, useSession } from '@/auth/session';
import { FormError } from '@/components/form-error';
import { FormActions, FormSection, TextField } from '@/components/patterns/form-section';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfig } from '@/config/useConfig';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthLayout } from './AuthLayout';

const LINK = buttonVariants({ variant: 'link', className: 'h-auto p-0' });

const email = z.string().trim().min(1, 'Enter your email.').pipe(z.email('Enter a valid email.'));
const password = (message: string) => z.string().min(1, message);

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

/** A card holding one form. `noValidate`: the schema says what is wrong, in the page's words. */
function FormCard({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-4"
        >
          {children}
        </form>
      </CardContent>
    </Card>
  );
}

const LoginSchema = z.object({ email, password: password('Enter your password.') });
type LoginValues = z.infer<typeof LoginSchema>;

export function LoginPage() {
  const registrationOpen = useConfig().features.registrationOpen;
  const enter = useEnter();
  const { search } = useLocation();
  const signedIn = useAlreadySignedIn();
  const { control, handleSubmit, setError } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: enter,
    onError: (error) => applyServerErrors(setError, error, ['email', 'password']),
  });

  if (signedIn && !login.isSuccess) return <Navigate to={signedIn} replace />;
  return (
    <AuthLayout title="Sign in">
      <FormCard onSubmit={() => void handleSubmit((values) => login.mutate(values))()}>
        <FormSection title="Your account" columns="one">
          <TextField
            control={control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
          />
          <TextField
            control={control}
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
          />
        </FormSection>
        <FormError error={login.error} fields={['email', 'password']} />
        <FormActions>
          <Button type="submit" className="flex-1 md:flex-none" disabled={login.isPending}>
            Sign in
          </Button>
        </FormActions>
      </FormCard>
      <p className="flex justify-between text-sm">
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
    </AuthLayout>
  );
}

const RegisterSchema = z.object({
  name: z.string().trim(),
  email,
  password: password('Choose a password.'),
});
type RegisterValues = z.infer<typeof RegisterSchema>;

export function RegisterPage() {
  const enter = useEnter();
  const { search } = useLocation();
  const signedIn = useAlreadySignedIn();
  const registrationOpen = useConfig().features.registrationOpen;
  const { control, handleSubmit, setError } = useForm<RegisterValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const register = useMutation({
    mutationFn: api.register,
    onSuccess: enter,
    onError: (error) => applyServerErrors(setError, error, ['name', 'email', 'password']),
  });

  if (signedIn && !register.isSuccess) return <Navigate to={signedIn} replace />;
  if (!registrationOpen) {
    return (
      <AuthLayout title="Create an account">
        <Card>
          <CardContent className="text-sm">
            Registration is closed.{' '}
            <Link to="/login" className={LINK}>
              Sign in
            </Link>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Create an account">
      <FormCard onSubmit={() => void handleSubmit((values) => register.mutate(values))()}>
        <FormSection title="Your details" columns="one">
          <TextField control={control} name="name" label="Name" autoComplete="name" />
          <TextField
            control={control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
          />
          <TextField
            control={control}
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
          />
        </FormSection>
        <FormError error={register.error} fields={['name', 'email', 'password']} />
        <FormActions>
          <Button type="submit" className="flex-1 md:flex-none" disabled={register.isPending}>
            Create account
          </Button>
        </FormActions>
      </FormCard>
      <p className="text-sm">
        Already have an account?{' '}
        <Link to={`/login${search}`} className={LINK}>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

const ForgotSchema = z.object({ email });
type ForgotValues = z.infer<typeof ForgotSchema>;

export function ForgotPasswordPage() {
  const { control, handleSubmit, setError, getValues } = useForm<ForgotValues>({
    resolver: zodResolver(ForgotSchema),
    defaultValues: { email: '' },
  });
  const reset = useMutation({
    mutationFn: api.requestPasswordReset,
    onError: (error) => applyServerErrors(setError, error, ['email']),
  });

  return (
    <AuthLayout title="Forgot password">
      {reset.isSuccess ? (
        <Card>
          <CardContent role="status" className="text-sm">
            If an account exists for {getValues('email')}, an email with a link to choose a new
            password is on its way.
          </CardContent>
        </Card>
      ) : (
        <FormCard onSubmit={() => void handleSubmit((values) => reset.mutate(values))()}>
          <FormSection
            title="Your account"
            description="Enter the email of your account and we will send a link to choose a new password."
            columns="one"
          >
            <TextField
              control={control}
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              required
            />
          </FormSection>
          <FormError error={reset.error} fields={['email']} />
          <FormActions>
            <Button type="submit" className="flex-1 md:flex-none" disabled={reset.isPending}>
              Send the link
            </Button>
          </FormActions>
        </FormCard>
      )}
      <p className="text-sm">
        <Link to="/login" className={LINK}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

const ResetSchema = z.object({ password: password('Choose a new password.') });
type ResetValues = z.infer<typeof ResetSchema>;

/** Where the link in the password reset email leads. */
export function ResetPasswordPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const uid = params.get('uid') ?? '';
  const token = params.get('token') ?? '';
  const { control, handleSubmit, setError } = useForm<ResetValues>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { password: '' },
  });
  const confirm = useMutation({
    mutationFn: api.confirmPasswordReset,
    onError: (error) =>
      applyServerErrors(setError, error, ['password'], { password: ['password', 'token', 'uid'] }),
  });

  return (
    <AuthLayout title="Choose a new password">
      {confirm.isSuccess ? (
        <Card>
          <CardContent role="status" className="text-sm">
            Your password was changed.{' '}
            <Link to="/login" className={LINK}>
              Sign in
            </Link>
          </CardContent>
        </Card>
      ) : (
        <FormCard
          onSubmit={() =>
            void handleSubmit((values) => confirm.mutate({ uid, token, ...values }))()
          }
        >
          <FormSection title="New password" columns="one">
            <TextField
              control={control}
              name="password"
              label="New password"
              type="password"
              autoComplete="new-password"
              required
            />
          </FormSection>
          <FormError error={confirm.error} fields={['password', 'token', 'uid']} />
          <FormActions>
            <Button type="submit" className="flex-1 md:flex-none" disabled={confirm.isPending}>
              Change password
            </Button>
          </FormActions>
        </FormCard>
      )}
    </AuthLayout>
  );
}
