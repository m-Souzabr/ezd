import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { ApiError, type ConfigDraft, type ConfigVersion } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { makeUser } from '../test/users';
import { AppSettingsPage } from './AppSettings';

const draft = (overrides: Partial<ConfigDraft> = {}): ConfigDraft => ({
  revision: 0,
  app_config: {},
  based_on: null,
  updated_at: null,
  ...overrides,
});

const version = (number: number, status: ConfigVersion['status']): ConfigVersion => ({
  number,
  status,
  note: `note ${number}`,
  created_by: 'ada@example.com',
  created_at: '2026-01-02T03:04:05Z',
});

function setup(options: { draft?: ConfigDraft; versions?: ConfigVersion[]; can?: boolean } = {}) {
  const spies = {
    getConfigDraft: vi
      .spyOn(client.api, 'getConfigDraft')
      .mockResolvedValue(options.draft ?? draft()),
    saveConfigDraft: vi
      .spyOn(client.api, 'saveConfigDraft')
      .mockImplementation(async (revision, config) =>
        draft({ revision: revision + 1, app_config: config }),
      ),
    publishConfig: vi.spyOn(client.api, 'publishConfig').mockResolvedValue(version(1, 'published')),
    listConfigVersions: vi
      .spyOn(client.api, 'listConfigVersions')
      .mockResolvedValue(options.versions ?? []),
    rollbackConfig: vi
      .spyOn(client.api, 'rollbackConfig')
      .mockResolvedValue(version(3, 'published')),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const permissions = options.can === false ? [] : ['config.app.edit'];
  queryClient.setQueryData(SESSION_KEY, makeUser({ permissions }));
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return spies;
}

afterEach(() => vi.restoreAllMocks());

const group = (name: string) => screen.getByRole('region', { name });

describe('the app settings page', () => {
  it('is for those who may edit the app settings', () => {
    setup({ can: false });
    expect(screen.getByText('Your role does not include this section.')).toBeInTheDocument();
  });

  it('shows the groups with the defaults filled in', async () => {
    setup();
    await screen.findByRole('region', { name: 'Panels' });
    for (const name of ['Panels', 'Features', 'Toolbar', 'Viewport', 'Theme', 'Help']) {
      expect(group(name)).toBeInTheDocument();
    }
    expect(within(group('Panels')).getByLabelText('Properties window')).toBeChecked();
    expect(within(group('Theme')).getByLabelText('Wall')).toHaveValue('#475569');
    expect(screen.getByText(/uses its defaults/)).toBeInTheDocument();
  });

  it('saves the draft with the revision it loaded', async () => {
    const { saveConfigDraft } = setup({ draft: draft({ revision: 4, based_on: 2 }) });
    fireEvent.click(await screen.findByLabelText('Properties window'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveConfigDraft).toHaveBeenCalledTimes(1));
    const [revision, config] = saveConfigDraft.mock.calls[0]!;
    expect(revision).toBe(4);
    expect(
      (config as { panels: { properties: { visible: boolean } } }).panels.properties.visible,
    ).toBe(false);
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('shows core’s message for a bad color and blocks saving and publishing', async () => {
    setup();
    await screen.findByRole('region', { name: 'Theme' });
    const wall = within(group('Theme')).getByLabelText('Wall');
    fireEvent.change(wall, { target: { value: 'red' } });
    expect(await screen.findByText('Use a color such as #1a2b3c.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 problem to fix first.');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeDisabled();
    fireEvent.change(wall, { target: { value: '#00ff00' } });
    await waitFor(() =>
      expect(screen.queryByText('Use a color such as #1a2b3c.')).not.toBeInTheDocument(),
    );
  });

  it('checks the rules across fields, and will not hide the Select tool', async () => {
    setup();
    fireEvent.click(await screen.findByLabelText('Select'));
    expect(await screen.findByText(/Select tool cannot be hidden/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select'));
    fireEvent.change(screen.getByLabelText('Smallest scale'), { target: { value: '9' } });
    expect(await screen.findByText(/default scale must lie between/i)).toBeInTheDocument();
  });

  it('resets one group to the defaults', async () => {
    setup();
    fireEvent.click(await screen.findByLabelText('Quotes'));
    expect(screen.getByLabelText('Quotes')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Panels to defaults' }));
    expect(screen.getByLabelText('Quotes')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Features to defaults' }));
    expect(screen.getByLabelText('Quotes')).toBeChecked();
  });

  it('edits the catalog order and the help steps', async () => {
    const { saveConfigDraft } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Move base down' }));
    fireEvent.change(screen.getByLabelText('Title of tall'), { target: { value: 'Pantry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveConfigDraft).toHaveBeenCalled());
    const config = saveConfigDraft.mock.calls[0]![1] as {
      panels: { catalog: { order: string[]; groups: { tall: { title: string } } } };
      help: { steps: { title: string }[] };
    };
    expect(config.panels.catalog.order.slice(0, 2)).toEqual(['wall', 'base']);
    expect(config.panels.catalog.groups.tall.title).toBe('Pantry');
    expect(config.help.steps).toHaveLength(5);
    expect(config.help.steps[4]!.title).toBe('New step');
  });

  it('publishes with a note, saving the unsaved edits first', async () => {
    const { saveConfigDraft, publishConfig } = setup({
      draft: draft({ revision: 2, based_on: 1 }),
    });
    fireEvent.click(await screen.findByLabelText('Properties window'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    fireEvent.change(await screen.findByLabelText(/Note/), { target: { value: 'Hide it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishConfig).toHaveBeenCalledWith(3, 'Hide it'));
    expect(saveConfigDraft).toHaveBeenCalledWith(2, expect.anything());
    expect(await screen.findByText('Published as version 1.')).toBeInTheDocument();
  });

  it('says so when the draft was changed by someone else', async () => {
    const { saveConfigDraft } = setup({ draft: draft({ revision: 1, based_on: 1 }) });
    saveConfigDraft.mockRejectedValue(new ApiError(409, { detail: 'stale' }));
    fireEvent.click(await screen.findByLabelText('Quotes'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Someone else changed the draft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the latest draft' })).toBeInTheDocument();
  });

  it('lists the versions and rolls back after a confirm', async () => {
    const { rollbackConfig } = setup({
      draft: draft({ based_on: 2 }),
      versions: [version(2, 'published'), version(1, 'superseded')],
    });
    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Roll back to version 2' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to version 1' }));
    expect(rollbackConfig).not.toHaveBeenCalled();
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Roll back' }),
    );
    await waitFor(() => expect(rollbackConfig).toHaveBeenCalledWith(1));
  });
});
