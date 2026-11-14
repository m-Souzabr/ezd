import { DEFAULT_QUOTE_DEFAULTS, validateQuoteDefaults } from '@ezd/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { api, ApiError, type Quote, type QuoteSummary } from '../api/client';
import { QuoteDefaultsContext } from '../config/useConfig';
import { DesignStoreProvider } from '../store/context';
import { room, seedItem, storeFor, WALLS } from '../test/kitchen';
import { QuotesDialog } from './QuotesDialog';

const [A] = WALLS;
const DESIGN = 'design-0001';
const DRAWINGS = { plan: 'data:image/png;base64,AAAA', elevations: [] };

function Where() {
  return <p>at {useLocation().pathname}</p>;
}

function setup({
  quotes = [] as QuoteSummary[],
  items = [seedItem('item-000001', 'base.standard', A, 0)],
  beforeQuote = vi.fn(async () => 4),
  defaults = DEFAULT_QUOTE_DEFAULTS,
} = {}) {
  const store = storeFor(room(144, 120, ...items));
  vi.spyOn(api, 'listQuotes').mockResolvedValue(quotes);
  const capture = vi.fn(async () => DRAWINGS);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/designs/d']}>
        <QuoteDefaultsContext.Provider value={defaults}>
          <DesignStoreProvider store={store}>
            <Routes>
              <Route
                path="/designs/d"
                element={
                  <QuotesDialog
                    designId={DESIGN}
                    trigger={<button type="button">Quotes</button>}
                    beforeQuote={beforeQuote}
                    capture={capture}
                  />
                }
              />
              <Route path="/quotes/:id" element={<Where />} />
            </Routes>
          </DesignStoreProvider>
        </QuoteDefaultsContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quotes' }));
  return { store, capture, beforeQuote };
}

const newQuote = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'New quote' }));
  return screen.getByRole('dialog', { name: 'New quote' });
};

// The dialog is loaded when first opened; load it now, so a test does not wait for the transform.
beforeAll(() => import('./QuotesDialogBody'));

afterEach(() => vi.restoreAllMocks());

describe('QuotesDialog', () => {
  it('lists the quotes of the design', async () => {
    setup({
      quotes: [
        {
          id: 'q1',
          number: 2,
          customer_name: 'Grace Hopper',
          total_cents: 123450,
          design_version: 3,
          created_at: '2026-11-12T10:00:00Z',
        },
      ],
    });

    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Quote 2');
    expect(row).toHaveTextContent('Grace Hopper');
    expect(row).toHaveTextContent('$1,234.50');
    expect(row).toHaveTextContent('November 12, 2026 · version 3');
    expect(within(row).getByRole('link', { name: 'Quote 2' })).toHaveAttribute(
      'href',
      '/quotes/q1',
    );
  });

  it('starts a new quote from the configured rates', async () => {
    const checked = validateQuoteDefaults({ markupBps: 2000, taxBps: 825 });
    if (!checked.ok) throw new Error('bad defaults');
    const create = vi.spyOn(api, 'createQuote').mockResolvedValue({
      id: 'q9',
    } as unknown as Quote);
    setup({
      defaults: checked.value,
      items: [
        seedItem('item-000001', 'base.standard', A, 0),
        seedItem('item-000002', 'base.standard', A, 30),
      ],
    });
    const form = await newQuote();
    expect(within(form).getByLabelText('Markup %')).toHaveValue('20');
    expect(within(form).getByLabelText('Discount %')).toHaveValue('0');
    expect(within(form).getByLabelText('Tax %')).toHaveValue('8.25');
    // 650 + 130 markup, plus 8.25 percent tax.
    expect(within(form).getByTestId('quote-form-total')).toHaveTextContent('$844.35');
    fireEvent.change(within(form).getByLabelText('Customer name'), { target: { value: 'Grace' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create quote' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1].settings).toEqual({
      markupBps: 2000,
      discountBps: 0,
      taxBps: 825,
      currency: 'USD',
    });
  });

  it('deletes a quote after asking once more', async () => {
    const remove = vi.spyOn(api, 'deleteQuote').mockResolvedValue(undefined);
    setup({
      quotes: [
        {
          id: 'q1',
          number: 1,
          customer_name: 'Grace',
          total_cents: 100,
          design_version: 1,
          created_at: '2026-11-12T10:00:00Z',
        },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete quote 1' }));
    expect(remove).not.toHaveBeenCalled();
    // A locator changed with the Base UI alert dialog: the second step is its own dialog.
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete quote 1?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete for good' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('q1', expect.anything()));
  });

  it('shows the total as the rates are typed', async () => {
    setup({
      items: [
        seedItem('item-000001', 'base.standard', A, 0),
        seedItem('item-000002', 'base.standard', A, 30),
      ],
    });
    const form = await newQuote();

    // Two base cabinets at $325.00.
    expect(within(form).getByTestId('quote-form-total')).toHaveTextContent('$650.00');
    fireEvent.change(within(form).getByLabelText('Markup %'), { target: { value: '20' } });
    fireEvent.change(within(form).getByLabelText('Tax %'), { target: { value: '8.25' } });
    // 650 + 130 = 780, plus 64.35 tax.
    expect(within(form).getByTestId('quote-form-total')).toHaveTextContent('$844.35');

    fireEvent.change(within(form).getByLabelText('Tax %'), { target: { value: '8.255' } });
    expect(within(form).getByText('A percentage, such as 8.25.')).toBeInTheDocument();
    expect(within(form).queryByTestId('quote-form-total')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Discount %'), { target: { value: '101' } });
    fireEvent.change(within(form).getByLabelText('Tax %'), { target: { value: '0' } });
    expect(
      within(form).getByText(/^Discount must be between 0 and 100 percent/),
    ).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Create quote' })).toBeDisabled();
  });

  it('creates the quote from the saved revision and opens it', async () => {
    const created = { id: 'q9' } as Quote;
    const create = vi.spyOn(api, 'createQuote').mockResolvedValue(created);
    const { capture, beforeQuote } = setup();
    const form = await newQuote();

    expect(within(form).getByRole('button', { name: 'Create quote' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Customer name'), {
      target: { value: '  Grace Hopper ' },
    });
    fireEvent.change(within(form).getByLabelText('Tax %'), { target: { value: '8.25' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create quote' }));

    expect(await screen.findByText('at /quotes/q9')).toBeInTheDocument();
    expect(beforeQuote).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const [designId, body] = create.mock.calls[0]!;
    expect(designId).toBe(DESIGN);
    expect(body).toMatchObject({
      draft_revision: 4,
      customer_name: 'Grace Hopper',
      customer_email: '',
      catalog_version: 'seed-1',
      settings: { markupBps: 0, discountBps: 0, taxBps: 825, currency: 'USD' },
      totals: { subtotalCents: 32500, taxCents: 2681, totalCents: 35181 },
      drawings: DRAWINGS,
    });
    expect(body.lines).toEqual([
      expect.objectContaining({ catalogId: 'base.standard', finishName: 'White', quantity: 1 }),
    ]);
  });

  it('blocks a design with errors unless the user overrides', async () => {
    const create = vi.spyOn(api, 'createQuote').mockResolvedValue({ id: 'q9' } as Quote);
    // Two cabinets in the same place overlap, which is an error.
    setup({
      items: [
        seedItem('item-000001', 'base.standard', A, 0),
        seedItem('item-000002', 'base.standard', A, 0),
      ],
    });
    const form = await newQuote();
    fireEvent.change(within(form).getByLabelText('Customer name'), { target: { value: 'Grace' } });

    expect(within(form).getByText(/^The design has \d+ errors?\./)).toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Create quote' });
    expect(submit).toBeDisabled();

    fireEvent.click(within(form).getByLabelText('Create the quote anyway'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it('explains a design that changed while the quote was made', async () => {
    vi.spyOn(api, 'createQuote').mockRejectedValue(new ApiError(409, { draft_revision: 5 }));
    setup();
    const form = await newQuote();
    fireEvent.change(within(form).getByLabelText('Customer name'), { target: { value: 'Grace' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create quote' }));

    expect(
      await within(form).findByText(
        'The design changed while the quote was being made. Try again.',
      ),
    ).toBeInTheDocument();
  });

  it('does not quote a design that could not be saved', async () => {
    const create = vi.spyOn(api, 'createQuote');
    setup({
      beforeQuote: vi.fn(async () => {
        throw new Error('The design has changes that could not be saved yet.');
      }),
    });
    const form = await newQuote();
    fireEvent.change(within(form).getByLabelText('Customer name'), { target: { value: 'Grace' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create quote' }));

    expect(
      await within(form).findByText(
        'The quote was not created: The design has changes that could not be saved yet.',
      ),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
