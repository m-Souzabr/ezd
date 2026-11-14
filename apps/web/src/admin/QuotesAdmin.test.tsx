import type { QuoteDefaultsInput } from '@ezd/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { type ConfigDraft } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { makeUser } from '../test/users';
import * as logo from './logo';
import { QuotesAdminPage } from './QuotesAdmin';

vi.mock('../quotes/pdf', () => ({
  renderQuotePdf: vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })),
}));

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

const draft = (overrides: Partial<ConfigDraft> = {}): ConfigDraft => ({
  revision: 0,
  app_config: {},
  rules_config: {},
  quote_defaults: {},
  based_on: null,
  updated_at: null,
  updated_by: '',
  ...overrides,
});

function setup(options: { draft?: ConfigDraft; can?: boolean } = {}) {
  const spies = {
    getConfigDraft: vi
      .spyOn(client.api, 'getConfigDraft')
      .mockResolvedValue(options.draft ?? draft()),
    saveQuoteDefaultsDraft: vi
      .spyOn(client.api, 'saveQuoteDefaultsDraft')
      .mockImplementation(async (revision, defaults) =>
        draft({ revision: revision + 1, quote_defaults: defaults }),
      ),
    publishConfig: vi.spyOn(client.api, 'publishConfig').mockResolvedValue({
      number: 3,
      status: 'published',
      note: '',
      created_by: 'ada@example.com',
      created_at: '2026-01-02T03:04:05Z',
    }),
    listConfigVersions: vi.spyOn(client.api, 'listConfigVersions').mockResolvedValue([]),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    SESSION_KEY,
    makeUser({ permissions: options.can === false ? [] : ['config.quote.edit'] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuotesAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return spies;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(logo, 'samplePlanImage').mockResolvedValue('data:image/png;base64,AAAA');
});
afterEach(() => vi.restoreAllMocks());

const savedOf = (spy: ReturnType<typeof setup>['saveQuoteDefaultsDraft']) =>
  spy.mock.calls[0]![1] as NonNullable<QuoteDefaultsInput>;

describe('the quotes page', () => {
  it('is for those who may edit the quote defaults', () => {
    setup({ can: false });
    expect(screen.getByText('Your role does not include this section.')).toBeInTheDocument();
  });

  it('shows the defaults: no markup, discount or tax, and no branding', async () => {
    setup();
    await screen.findByRole('region', { name: 'Default rates' });
    expect(screen.getByLabelText('Markup %')).toHaveValue('0');
    expect(screen.getByLabelText('Discount %')).toHaveValue('0');
    expect(screen.getByLabelText('Tax %')).toHaveValue('0');
    expect(screen.getByLabelText('Company name')).toHaveValue('');
    expect(screen.getByText('Quote 3 is shown as 3.')).toBeInTheDocument();
  });

  it('saves the rates in basis points and the branding as typed', async () => {
    const { saveQuoteDefaultsDraft } = setup({ draft: draft({ revision: 2, based_on: 1 }) });
    await screen.findByRole('region', { name: 'Default rates' });
    fireEvent.change(screen.getByLabelText('Markup %'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: '8.25' } });
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Kitchens' } });
    fireEvent.change(screen.getByLabelText('Quote number prefix'), { target: { value: 'AK-' } });
    fireEvent.change(screen.getByLabelText('Footer text'), {
      target: { value: 'Good for 30 days.' },
    });
    expect(screen.getByText('Quote 3 is shown as AK-3.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuoteDefaultsDraft).toHaveBeenCalledTimes(1));
    expect(saveQuoteDefaultsDraft.mock.calls[0]![0]).toBe(2);
    expect(savedOf(saveQuoteDefaultsDraft)).toMatchObject({
      markupBps: 1500,
      discountBps: 0,
      taxBps: 825,
      currency: 'USD',
      branding: {
        companyName: 'Acme Kitchens',
        numberPrefix: 'AK-',
        footerText: 'Good for 30 days.',
      },
    });
  });

  it('blocks saving while a rate is not a percentage, and while the prefix has a space', async () => {
    setup();
    await screen.findByRole('region', { name: 'Default rates' });
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: 'lots' } });
    expect(await screen.findByText('A percentage, such as 8.25.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Quote number prefix'), { target: { value: 'A B' } });
    expect(
      await screen.findByText('Letters, digits, dots, dashes and underscores only.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 problem to fix first.');
    fireEvent.change(screen.getByLabelText('Quote number prefix'), { target: { value: 'AB' } });
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeEnabled();
  });

  it('refuses a rate over what a quote may carry', async () => {
    setup();
    await screen.findByRole('region', { name: 'Default rates' });
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: '150' } });
    expect(
      await screen.findByText(/Discount must be between 0 and 100 percent/),
    ).toBeInTheDocument();
  });

  it('takes a logo from a file, shows it and can remove it', async () => {
    const fileToLogo = vi.spyOn(logo, 'fileToLogo').mockResolvedValue(LOGO);
    const { saveQuoteDefaultsDraft } = setup();
    await screen.findByRole('region', { name: 'Company branding' });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [file] } });
    expect(await screen.findByAltText('Current logo')).toHaveAttribute('src', LOGO);
    expect(fileToLogo).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuoteDefaultsDraft).toHaveBeenCalled());
    expect(savedOf(saveQuoteDefaultsDraft).branding?.logo).toBe(LOGO);
    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(screen.queryByAltText('Current logo')).not.toBeInTheDocument();
  });

  it('says why a logo was refused', async () => {
    vi.spyOn(logo, 'fileToLogo').mockRejectedValue(new Error('That image is over 4 MB.'));
    setup();
    await screen.findByRole('region', { name: 'Company branding' });
    fireEvent.change(screen.getByLabelText('Logo'), {
      target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('That image is over 4 MB.')).toBeInTheDocument();
    expect(screen.queryByAltText('Current logo')).not.toBeInTheDocument();
  });

  it('previews the PDF of a sample quote with this branding', async () => {
    const { renderQuotePdf } = await import('../quotes/pdf');
    setup();
    await screen.findByRole('region', { name: 'PDF preview' });
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Kitchens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    const frame = await screen.findByTitle('Quote PDF preview');
    expect(frame).toHaveAttribute('src', 'blob:preview');
    const quote = vi.mocked(renderQuotePdf).mock.calls[0]![0];
    expect(quote.branding.companyName).toBe('Acme Kitchens');
    expect(quote.totals.totalCents).toBe(32500 * 3 + 41000 * 2);
  });

  it('says so when the preview cannot be drawn', async () => {
    const { renderQuotePdf } = await import('../quotes/pdf');
    vi.mocked(renderQuotePdf).mockRejectedValueOnce(new Error('boom'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText('The preview could not be drawn.')).toBeInTheDocument();
  });

  it('resets the form to the defaults', async () => {
    setup({
      draft: draft({
        revision: 1,
        based_on: 1,
        quote_defaults: { markupBps: 2000, branding: { companyName: 'Acme' } },
      }),
    });
    expect(await screen.findByLabelText('Markup %')).toHaveValue('20');
    expect(screen.getByLabelText('Company name')).toHaveValue('Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByLabelText('Markup %')).toHaveValue('0');
    expect(screen.getByLabelText('Company name')).toHaveValue('');
  });

  it('publishes what is on screen', async () => {
    const { saveQuoteDefaultsDraft, publishConfig } = setup();
    await screen.findByRole('region', { name: 'Default rates' });
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishConfig).toHaveBeenCalled());
    expect(savedOf(saveQuoteDefaultsDraft).taxBps).toBe(700);
    expect(await screen.findByText('Published as version 3.')).toBeInTheDocument();
  });
});
