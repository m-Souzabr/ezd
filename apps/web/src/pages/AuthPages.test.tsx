import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
