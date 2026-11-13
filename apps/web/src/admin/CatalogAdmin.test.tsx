import { type Catalog, getEntry, SEED_CATALOG } from '@ezd/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { ApiError, type CatalogDraft, type CatalogVersion } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { makeUser } from '../test/users';
import { CatalogAdminPage } from './CatalogAdmin';

const draft = (overrides: Partial<CatalogDraft> = {}): CatalogDraft => ({
  revision: 0,
  catalog: SEED_CATALOG,
  based_on: 'seed-1',
  updated_at: null,
  ...overrides,
});

const version = (name: string, current: boolean): CatalogVersion => ({
  number: Number(name.split('-')[1]),
  version: name,
  current,
  note: `note ${name}`,
  created_by: 'ada@example.com',
  created_at: '2026-01-02T03:04:05Z',
});

function setup(options: { draft?: CatalogDraft; versions?: CatalogVersion[]; can?: boolean } = {}) {
  const spies = {
    getCatalogDraft: vi
      .spyOn(client.api, 'getCatalogDraft')
      .mockResolvedValue(options.draft ?? draft()),
    saveCatalogDraft: vi
      .spyOn(client.api, 'saveCatalogDraft')
      .mockImplementation(async (revision, catalog) =>
        draft({ revision: revision + 1, catalog: catalog as Catalog }),
      ),
    publishCatalog: vi
      .spyOn(client.api, 'publishCatalog')
      .mockResolvedValue(version('catalog-2', true)),
    getCatalog: vi.spyOn(client.api, 'getCatalog').mockResolvedValue({
      version: 'seed-1',
      catalog: SEED_CATALOG,
    }),
    listCatalogVersions: vi
      .spyOn(client.api, 'listCatalogVersions')
      .mockResolvedValue(
        options.versions ?? [version('catalog-2', true), version('seed-1', false)],
      ),
    rollbackCatalog: vi
      .spyOn(client.api, 'rollbackCatalog')
      .mockResolvedValue(version('catalog-3', true)),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const permissions = options.can === false ? [] : ['config.catalog.edit'];
  queryClient.setQueryData(SESSION_KEY, makeUser({ permissions }));
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CatalogAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return spies;
}

afterEach(() => vi.restoreAllMocks());

const type = (label: string | RegExp, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('the catalog page', () => {
  it('needs the permission', async () => {
    setup({ can: false });
    expect(await screen.findByText('Your role does not include this section.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lists the entries and filters them by search and kind', async () => {
    setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    const list = screen.getByRole('region', { name: 'Cabinets' });
    expect(within(list).getByText('Base cabinet')).toBeInTheDocument();
    expect(within(list).getByText('Range hood')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search cabinets'), { target: { value: 'hood' } });
    expect(within(list).queryByText('Base cabinet')).not.toBeInTheDocument();
    expect(within(list).getByText('Range hood')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search cabinets'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Kind', { selector: 'select' }), {
      target: { value: 'filler' },
    });
    expect(within(list).queryByText('Base cabinet')).not.toBeInTheDocument();
    expect(within(list).getByText('Base filler')).toBeInTheDocument();
  });

  it('hides retired entries until asked', async () => {
    const retired = {
      ...SEED_CATALOG,
      entries: SEED_CATALOG.entries.map((entry) =>
        entry.id === 'base.drawers' ? { ...entry, retired: true } : entry,
      ),
    };
    setup({ draft: draft({ catalog: retired }) });
    const list = await screen.findByRole('region', { name: 'Cabinets' });
    expect(within(list).queryByText('Drawer base cabinet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show retired'));
    expect(within(list).getByText(/base\.drawers · retired/)).toBeInTheDocument();
  });

  it('edits a price in dollars and saves the draft in cents', async () => {
    const spies = setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Base price ($)', '130.50');
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(spies.saveCatalogDraft).toHaveBeenCalledTimes(1));
    const [revision, saved] = spies.saveCatalogDraft.mock.calls[0]!;
    expect(revision).toBe(0);
    expect(getEntry(saved as Catalog, 'base.standard')!.price.baseCents).toBe(13050);
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('refuses a price that is not money, and shows it under the field', async () => {
    setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Base price ($)', 'a lot');
    expect(await screen.findByText(/amount in dollars/)).toBeInTheDocument();
  });

  it('shows what core says as you type, and will not publish until it is fixed', async () => {
    setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Default width', '31');
    const problems = await screen.findByRole('list', { name: 'Problems with this entry' });
    expect(
      within(problems).getByText(/default width .* is not an allowed width/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 problem to fix first.');
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeDisabled();
    // The list shows which entry has them.
    expect(screen.getByText(/base\.standard · 1 problem/)).toBeInTheDocument();
    type('Default width', '30');
    await waitFor(() =>
      expect(
        screen.queryByRole('list', { name: 'Problems with this entry' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('adds a cabinet that starts valid, and retires one', async () => {
    setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    fireEvent.click(screen.getByRole('button', { name: 'New cabinet' }));
    const dialog = await screen.findByRole('dialog', { name: 'New cabinet' });
    fireEvent.change(within(dialog).getByLabelText(/^Id/), { target: { value: 'base.standard' } });
    expect(within(dialog).getByText('That id is already used.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add cabinet' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Id/), { target: { value: 'base.deep' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Deep base' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add cabinet' }));

    expect(await screen.findByRole('group', { name: 'Entry base.deep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/^Retired/));
    expect(screen.getByText('Retired', { selector: 'span' })).toBeInTheDocument();
  });

  it('edits widths, options and placement', async () => {
    setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Widest', '51');
    type(/^Heights/, '34 1/2, 36');
    fireEvent.click(screen.getByLabelText('Free-standing'));
    fireEvent.click(screen.getByLabelText('Free-standing'));
    fireEvent.click(screen.getByRole('button', { name: 'Add a yes/no option' }));
    expect(screen.getAllByLabelText('Option key').length).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Remove option option4' }));
    expect(screen.getAllByLabelText('Option key').length).toBe(3);
    expect(screen.getByLabelText(/^Heights/)).toHaveValue('34 1/2", 36"');
    expect(screen.getByLabelText('Widest')).toHaveValue('51"');
  });

  it('edits a finish: color, multiplier and price per square foot', async () => {
    const spies = setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    fireEvent.click(screen.getByRole('tab', { name: /Finishes/ }));
    const navy = await screen.findByRole('listitem', { name: 'Finish cabinet.navy' });
    fireEvent.change(within(navy).getByLabelText('Color picker for cabinet.navy'), {
      target: { value: '#112233' },
    });
    const multiplier = within(navy).getByLabelText('Price multiplier (%)');
    fireEvent.change(multiplier, { target: { value: '125' } });
    fireEvent.blur(multiplier);
    expect(within(navy).getByLabelText('Color code')).toHaveValue('#112233');
    const stone = screen.getByRole('listitem', { name: 'Finish countertop.white' });
    fireEvent.change(within(stone).getByLabelText('Price per square foot ($)'), {
      target: { value: '70' },
    });
    fireEvent.blur(within(stone).getByLabelText('Price per square foot ($)'));

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(spies.saveCatalogDraft).toHaveBeenCalled());
    const saved = spies.saveCatalogDraft.mock.calls[0]![1] as Catalog;
    const finish = (id: string) => saved.finishes.find((f) => f.id === id)!;
    expect(finish('cabinet.navy')).toMatchObject({ color: '#112233', multiplierBps: 12500 });
    expect(finish('countertop.white').pricePerSqftCents).toBe(7000);
  });

  it('adds and retires a finish, and refuses a bad color', async () => {
    setup();
    fireEvent.click(await screen.findByRole('tab', { name: /Finishes/ }));
    const form = screen.getByRole('form', { name: 'New finish' });
    fireEvent.change(within(form).getByLabelText('New finish id'), {
      target: { value: 'cabinet.white' },
    });
    expect(within(form).getByText('That id is already used.')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('New finish id'), {
      target: { value: 'cabinet.teal' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add finish' }));
    const teal = await screen.findByRole('listitem', { name: 'Finish cabinet.teal' });
    fireEvent.click(within(teal).getByLabelText(/^Retired/));
    expect(within(teal).getByText('Retired', { selector: 'span' })).toBeInTheDocument();
    const code = within(teal).getByLabelText('Color code');
    fireEvent.change(code, { target: { value: 'teal' } });
    fireEvent.blur(code);
    expect(await within(teal).findByText(/Use a color like #a1b2c3/)).toBeInTheDocument();
  });

  it('publishes with a note after showing what changes', async () => {
    const spies = setup();
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Base price ($)', '130');
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this catalog?' });
    expect(
      await within(dialog).findByText(/Entry base\.standard: changed price/),
    ).toBeInTheDocument();
    const publish = within(dialog).getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Raise bases' } });
    fireEvent.click(publish);
    await waitFor(() => expect(spies.publishCatalog).toHaveBeenCalledWith(1, 'Raise bases'));
    // An unsaved edit is saved first, so what is published is what was on screen.
    expect(spies.saveCatalogDraft).toHaveBeenCalledWith(0, expect.anything());
    expect(await screen.findByText('Published as catalog-2.')).toBeInTheDocument();
  });

  it('lists the problems the server finds when it refuses to publish', async () => {
    const spies = setup();
    spies.publishCatalog.mockRejectedValue(
      new ApiError(422, {
        detail: 'The catalog is not valid.',
        errors: [{ path: 'entries.0.name', message: 'An entry needs a name.' }],
      }),
    );
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Base price ($)', '130');
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this catalog?' });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await within(dialog).findByText('An entry needs a name.')).toBeInTheDocument();
  });

  it('says so when someone else changed the draft', async () => {
    const spies = setup();
    spies.saveCatalogDraft.mockRejectedValue(new ApiError(409, { detail: 'stale' }));
    await screen.findByRole('group', { name: 'Entry base.standard' });
    type('Base price ($)', '130');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Someone else changed the draft/)).toBeInTheDocument();
  });

  it('shows the history and rolls back after confirming', async () => {
    const spies = setup();
    const history = await screen.findByRole('region', { name: 'Version history' });
    expect(await within(history).findByText('catalog-2')).toBeInTheDocument();
    expect(within(history).getAllByText('Published')).toHaveLength(1);
    fireEvent.click(within(history).getByRole('button', { name: 'Roll back to seed-1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Roll back to seed-1?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(spies.rollbackCatalog).toHaveBeenCalledWith('seed-1'));
  });
});
