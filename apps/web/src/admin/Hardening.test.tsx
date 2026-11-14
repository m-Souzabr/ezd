import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { ApiError, type AuditEntry, type DryRunResult, type Role } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { makeUser } from '../test/users';
import { AuditPage } from './AuditPage';
import { BackupPage } from './BackupPage';
import { ConflictNotice } from './ConflictNotice';
import { DryRunSummary } from './DryRunSummary';
import { RolesPage } from './RolesPage';
import { VersionCompare } from './VersionCompare';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAs(user: ReturnType<typeof makeUser>, ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(SESSION_KEY, user);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ADMIN = makeUser({
  permissions: [
    'audit.view',
    'users.view',
    'users.manage',
    'users.roles.manage',
    'config.catalog.edit',
    'config.rules.edit',
    'config.app.edit',
    'config.quote.edit',
  ],
});

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  actor: 1,
  actor_email: 'ada@example.com',
  action: 'config.publish',
  object_type: 'config_version',
  object_id: '4',
  before: null,
  after: null,
  changes: [
    { path: 'thresholds.minAisle', kind: 'changed', before: 432, after: 480 },
    { path: 'rules.room.open', kind: 'removed', before: { enabled: true } },
  ],
  created_at: '2026-11-13T12:00:00Z',
  ...overrides,
});

describe('the audit log', () => {
  function setup() {
    const list = vi.spyOn(client.api, 'listAudit').mockResolvedValue({
      rows: [entry(), entry({ id: 2, changes: [], action: 'user.invite' })],
      total: 2,
    });
    vi.spyOn(client.api, 'listAuditTypes').mockResolvedValue(['config_version', 'user']);
    renderAs(ADMIN, <AuditPage />);
    return list;
  }

  it('shows each row with a readable diff you can open', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Audit log' });
    const summary = await within(table).findByText('2 changes');
    fireEvent.click(summary);
    const diff = within(table).getByRole('list', { name: 'Changes in entry 1' });
    expect(within(diff).getAllByText('Changed')).toHaveLength(1);
    expect(within(diff).getByText('Removed')).toBeInTheDocument();
    expect(within(diff).getByText('thresholds.minAisle')).toBeInTheDocument();
    expect(within(diff).getByText('432')).toBeInTheDocument();
    expect(within(diff).getByText('480')).toBeInTheDocument();
    // A row with no field changes has nothing to open.
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('filters by actor, action, object type and dates, and starts again from the first page', async () => {
    const list = setup();
    await screen.findByRole('table', { name: 'Audit log' });
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'config.' } });
    await screen.findByRole('option', { name: 'config_version' });
    fireEvent.change(screen.getByLabelText('Object type'), { target: { value: 'config_version' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } });

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        actor: 'ada',
        action: 'config.',
        object_type: 'config_version',
        date_from: '2026-11-01',
        date_to: '2026-11-30',
        limit: 25,
        offset: 0,
      }),
    );
  });

  it('exports the rows that match as CSV', async () => {
    setup();
    await screen.findByRole('table', { name: 'Audit log' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'user.' } });
    const link = screen.getByRole('link', { name: 'Export CSV' });
    await waitFor(() =>
      expect(link).toHaveAttribute('href', '/api/admin/audit/export/?action=user.'),
    );
    expect(link).toHaveAttribute('download');
  });

  it('is closed to a user without audit.view', () => {
    renderAs(makeUser({ permissions: ['users.view'] }), <AuditPage />);
    expect(screen.getByText(/does not include this section/)).toBeInTheDocument();
  });
});

describe('the conflict notice', () => {
  it('says who saved the draft first, and when', () => {
    const error = new ApiError(409, {
      detail: 'Stale.',
      conflict: { updated_by: 'bob@example.com', updated_at: '2026-11-13T12:00:00Z', revision: 3 },
    });
    render(<ConflictNotice error={error} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Someone else changed the draft');
    expect(alert).toHaveTextContent('bob@example.com');
    expect(screen.getByRole('button', { name: 'Reload the latest draft' })).toBeInTheDocument();
  });

  it('still reads well when the server does not say who', () => {
    render(<ConflictNotice error={new ApiError(409, { detail: 'Stale.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('yours are not saved');
  });

  it('shows nothing for any other error', () => {
    const { container } = render(<ConflictNotice error={new ApiError(500, null)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the dry run summary', () => {
  const report = (over: Partial<DryRunResult['designs']> = {}): DryRunResult['designs'] => ({
    total: 80,
    sampled: 50,
    changed: 0,
    samples: [],
    ...over,
  });

  it('says nothing would change', async () => {
    const run = vi.fn().mockResolvedValue({ designs: report(), quotes: report({ sampled: 0 }) });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DryRunSummary queryKey={['t1']} run={run} unsaved={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Checking existing designs…')).toBeInTheDocument();
    expect(
      await screen.findByText('None of the 50 checked would change (the 50 most recent of 80).'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not saved/)).not.toBeInTheDocument();
  });

  it('lists the designs that would change, and says what is not counted', async () => {
    const run = vi.fn().mockResolvedValue({
      designs: report({
        changed: 1,
        samples: [
          { id: 'a', name: 'Kitchen', introduced: ['Too narrow'], cleared: ['Old problem'] },
        ],
      }),
      quotes: report({
        sampled: 4,
        total: 4,
        changed: 1,
        samples: [{ id: 'q', name: 'Quote 2', missing: ['base.old'] }],
      }),
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DryRunSummary queryKey={['t2']} run={run} unsaved />
      </QueryClientProvider>,
    );
    const designs = await screen.findByRole('region', { name: 'Designs' });
    expect(designs).toHaveTextContent('1 of 50 checked would change');
    expect(designs).toHaveTextContent('Kitchen');
    expect(designs).toHaveTextContent('New problem: Too narrow');
    expect(designs).toHaveTextContent('No longer a problem: Old problem');
    expect(screen.getByRole('region', { name: 'Quotes' })).toHaveTextContent(
      'No longer offered: base.old',
    );
    expect(screen.getByText(/edits you have not saved are not counted/)).toBeInTheDocument();
  });

  it('shows why the check could not run', async () => {
    const run = vi
      .fn()
      .mockRejectedValue(new ApiError(422, { detail: 'The catalog is not valid.' }));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DryRunSummary queryKey={['t3']} run={run} unsaved={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/The catalog is not valid/)).toBeInTheDocument();
  });
});

describe('comparing two versions', () => {
  it('lists what changed in each section', async () => {
    const load = vi.fn().mockResolvedValue({
      sections: {
        rules_config: [{ path: 'thresholds.minAisle', kind: 'changed', before: 432, after: 480 }],
        app_config: [],
      },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <VersionCompare
          kind="config"
          numbers={[3, 2, 1]}
          label={(n) => `Version ${n}`}
          load={load}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions…' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }));

    expect(await screen.findByText('thresholds.minAisle')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(1, 3);
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByText('No changes.')).toBeInTheDocument();
  });

  it('starts from the newest two versions, also when the list arrives after it mounts', async () => {
    const load = vi.fn().mockResolvedValue({ sections: {} });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (numbers: number[]) => (
      <QueryClientProvider client={client}>
        <VersionCompare kind="config" numbers={numbers} label={(n) => `Version ${n}`} load={load} />
      </QueryClientProvider>
    );
    const { rerender } = render(view([]));
    rerender(view([5, 4, 3]));
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }));
    await waitFor(() => expect(load).toHaveBeenCalledWith(4, 5));
  });

  it('needs two versions to compare', () => {
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <VersionCompare kind="config" numbers={[1]} label={String} load={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the roles page', () => {
  const ROLES: Role[] = [
    { id: 1, name: 'Administrator', permissions: ['audit.view'], protected: true, members: 2 },
    { id: 9, name: 'Auditor', permissions: ['audit.view'], protected: false, members: 1 },
  ];

  it('lists roles, marks the seeded ones and offers changes only on the others', async () => {
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    renderAs(ADMIN, <RolesPage />);
    const table = await screen.findByRole('table', { name: 'Roles' });
    expect(await within(table).findByText('Protected')).toBeInTheDocument();
    expect(within(table).getByText('Cannot be changed')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Edit Auditor' })).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Edit Administrator' })).toBeNull();
  });

  it('hides every change from a user who may only view', async () => {
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    renderAs(makeUser({ permissions: ['users.view'] }), <RolesPage />);
    await screen.findByRole('table', { name: 'Roles' });
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('creates a role, offering only the permissions you hold', async () => {
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    const create = vi.spyOn(client.api, 'createRole').mockResolvedValue(ROLES[1]!);
    renderAs(ADMIN, <RolesPage />);
    await screen.findByRole('table', { name: 'Roles' });
    fireEvent.click(screen.getByRole('button', { name: 'New role' }));

    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    // The administrator fixture does not hold llm.settings.edit.
    expect(within(dialog).getByRole('checkbox', { name: /Edit the AI settings/ })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /View the audit log/ })).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Reviewer ' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /View the audit log/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Reviewer', permissions: ['audit.view'] }),
    );
  });

  it('shows the server refusing a permission', async () => {
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    vi.spyOn(client.api, 'updateRole').mockRejectedValue(
      new ApiError(403, { detail: 'A role cannot grant a permission you do not hold.' }),
    );
    renderAs(ADMIN, <RolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Auditor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Auditor' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await within(dialog).findByText(/cannot grant a permission/)).toBeInTheDocument();
  });

  it('deletes a role after a confirm that says who loses it', async () => {
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    const remove = vi.spyOn(client.api, 'deleteRole').mockResolvedValue(undefined);
    renderAs(ADMIN, <RolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Auditor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Auditor?' });
    expect(dialog).toHaveTextContent('1 person holds this role');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(9));
  });
});

describe('the backup and reset page', () => {
  const file = (text: string, name = 'ezd.json') =>
    new File([text], name, { type: 'application/json' });
  const chooseFile = (f: File) =>
    fireEvent.change(screen.getByLabelText('Configuration file'), { target: { files: [f] } });

  function setup(user = ADMIN) {
    vi.spyOn(client.api, 'getConfigDraft').mockResolvedValue({
      revision: 2,
      app_config: {},
      rules_config: {},
      quote_defaults: {},
      based_on: 1,
      updated_at: null,
      updated_by: '',
    });
    vi.spyOn(client.api, 'getCatalogDraft').mockResolvedValue({
      revision: 5,
      catalog: {},
      based_on: 'catalog-1',
      updated_at: null,
      updated_by: '',
    });
    renderAs(user, <BackupPage />);
  }

  it('links the export of the published configuration', () => {
    setup();
    const link = screen.getByRole('link', { name: 'Export the published configuration' });
    expect(link).toHaveAttribute('href', '/api/admin/config/export/');
  });

  it('imports a file as drafts and says what to do next', async () => {
    setup();
    const importConfig = vi.spyOn(client.api, 'importConfig').mockResolvedValue({
      sections: ['rules_config', 'catalog'],
      config_revision: 3,
      catalog_revision: 6,
    });
    chooseFile(file('{"format":"ezd-config","formatVersion":1}'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import as draft' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import as draft' }));

    expect(await screen.findByText(/Saved rules_config, catalog as drafts/)).toBeInTheDocument();
    expect(importConfig).toHaveBeenCalledWith({ format: 'ezd-config', formatVersion: 1 }, false);
  });

  it('refuses a file that is not JSON without calling the server', async () => {
    setup();
    const importConfig = vi.spyOn(client.api, 'importConfig');
    chooseFile(file('not json', 'bad.txt'));
    expect(await screen.findByText('bad.txt is not a JSON file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import as draft' })).toBeDisabled();
    expect(importConfig).not.toHaveBeenCalled();
  });

  it('lists what is wrong with an invalid file and says nothing was changed', async () => {
    setup();
    vi.spyOn(client.api, 'importConfig').mockRejectedValue(
      new ApiError(422, {
        detail: 'The file is not a valid configuration export.',
        errors: [{ path: 'thresholds.minAisle', message: 'At most 72".' }],
      }),
    );
    chooseFile(file('{}'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import as draft' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import as draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('nothing was changed');
    expect(alert).toHaveTextContent('thresholds.minAisle');
    expect(alert).toHaveTextContent('At most 72"');
  });

  it('asks before replacing a draft that exists, and then replaces it', async () => {
    setup();
    const importConfig = vi
      .spyOn(client.api, 'importConfig')
      .mockRejectedValueOnce(
        new ApiError(409, {
          detail: 'There is a draft of the configuration.',
          conflict: {
            updated_by: 'bob@example.com',
            updated_at: '2026-11-13T12:00:00Z',
            revision: 2,
          },
        }),
      )
      .mockResolvedValueOnce({
        sections: ['app_config'],
        config_revision: 3,
        catalog_revision: null,
      });
    chooseFile(file('{"a":1}'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import as draft' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import as draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('bob@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Replace the draft…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace the draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace the draft' }));

    await waitFor(() => expect(importConfig).toHaveBeenLastCalledWith({ a: 1 }, true));
    expect(await screen.findByText(/Saved app_config as a draft/)).toBeInTheDocument();
  });

  it('resets a section to its defaults only after a confirm, at the revision it loaded', async () => {
    setup();
    const reset = vi.spyOn(client.api, 'resetSection').mockResolvedValue({
      sections: ['rules'],
      config_revision: 3,
      catalog_revision: null,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset rules…' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reset rules…' }));
    expect(reset).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Reset the rules draft to defaults/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith('rules', 2));
    expect(await screen.findByText('The rules draft now holds the defaults.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset catalog…' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: /Reset the catalog draft/ })).getByRole(
        'button',
        { name: 'Reset to defaults' },
      ),
    );
    await waitFor(() => expect(reset).toHaveBeenLastCalledWith('catalog', 5));
  });

  it('offers a reset only for the sections the user may edit', () => {
    setup(makeUser({ permissions: ['config.rules.edit'] }));
    expect(screen.getByRole('button', { name: 'Reset rules…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset catalog…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset app settings…' })).toBeNull();
  });

  it('is closed to a user with no configuration permission', () => {
    setup(makeUser({ permissions: ['users.view'] }));
    expect(screen.getByText(/does not include this section/)).toBeInTheDocument();
  });
});
