import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { WithConfig } from '../test/config';
import { LoginPage, RegisterPage } from './AuthPages';

function renderPage(page: 'login' | 'register', registrationOpen: boolean) {
  vi.spyOn(client.api, 'me').mockResolvedValue(null);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WithConfig input={{ features: { registrationOpen } }}>
        <MemoryRouter>{page === 'login' ? <LoginPage /> : <RegisterPage />}</MemoryRouter>
      </WithConfig>
    </QueryClientProvider>,
  );
}

describe('registration', () => {
  it('is offered by default', () => {
    renderPage('login', true);
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('is closed by the configuration: no link, ', () => {
    renderPage('login', false);
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('shows the register page as closed', () => {
    renderPage('register', false);
    expect(screen.getByText(/Registration is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});

describe('the login form', () => {
  it('names each empty field and does not send the request', async () => {
    renderPage('login', true);
    const login = vi.spyOn(client.api, 'login');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(login).not.toHaveBeenCalled();
  });

  it('keeps the field types and autocomplete hints', () => {
    renderPage('login', true);
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it("puts the server's message for a field under that field", async () => {
    renderPage('login', true);
    vi.spyOn(client.api, 'login').mockRejectedValue(
      new client.ApiError(400, { password: ['This password is wrong.'] }),
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('This password is wrong.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows an error that belongs to no field once, for the whole form', async () => {
    renderPage('login', true);
    vi.spyOn(client.api, 'login').mockRejectedValue(
      new client.ApiError(400, { detail: 'Unable to sign in.' }),
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign in.');
  });
});
