import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { ApiError, type User } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { makeAdminUser, makeUser } from '../test/users';
import { UsersPage } from './UsersPage';

const ROLES = [
  { id: 1, name: 'Administrator', permissions: [], protected: true, members: 1 },
  {
    id: 2,
    name: 'Support',
    permissions: ['users.manage', 'users.view'],
    protected: true,
    members: 1,
  },
];

function setup(me: User, rows = [makeAdminUser()], total = rows.length) {
  const spies = {
    listUsers: vi.spyOn(client.api, 'listUsers').mockResolvedValue({ rows, total }),
    listRoles: vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES),
    updateUser: vi.spyOn(client.api, 'updateUser').mockResolvedValue(rows[0]!),
    inviteUser: vi.spyOn(client.api, 'inviteUser').mockResolvedValue(rows[0]!),
    resetUserPassword: vi.spyOn(client.api, 'resetUserPassword').mockResolvedValue(undefined),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(SESSION_KEY, me);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return spies;
}

const SUPPORT = makeUser({ permissions: ['users.view', 'users.manage'] });
const ADMIN = makeUser({ permissions: ['users.view', 'users.manage', 'users.roles.assign'] });

afterEach(() => vi.restoreAllMocks());

/** The button that opens a user, in the table (the cards below 768 px hold the same). */
const userRow = async (name: string) =>
  within(await screen.findByRole('table', { name: 'Users' })).findByRole('button', { name });

describe('the user list', () => {
  it('shows the loading state, then a row for each user', async () => {
    setup(SUPPORT, [makeAdminUser(), makeAdminUser({ id: 3, email: 'cy@example.com', name: '' })]);
    expect(screen.getByRole('status', { name: 'Loading users' })).toBeInTheDocument();

    const table = await screen.findByRole('table', { name: 'Users' });
    expect(
      await within(table).findByRole('button', { name: 'bob@example.com' }),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('1,200')).toHaveLength(2);
    expect(within(table).getByText('cy@example.com')).toBeInTheDocument();
  });

  it('says when no user matches', async () => {
    setup(SUPPORT, []);
    expect(await screen.findByText('No users match')).toBeInTheDocument();
  });

  it('shows the failure of the request', async () => {
    vi.spyOn(client.api, 'listUsers').mockRejectedValue(new ApiError(403, { detail: 'Nope.' }));
    vi.spyOn(client.api, 'listRoles').mockResolvedValue(ROLES);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(SESSION_KEY, SUPPORT);
    render(
      <QueryClientProvider client={queryClient}>
        <UsersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
  });

  it('reads again with the search, the filters and the sort', async () => {
    const { listUsers } = setup(SUPPORT);
    await screen.findByRole('table', { name: 'Users' });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' bob ' } });
    fireEvent.change(screen.getByLabelText('Active'), { target: { value: 'no' } });
    fireEvent.change(screen.getByLabelText('Staff'), { target: { value: 'yes' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Support' } });
    fireEvent.click(
      within(await screen.findByRole('table', { name: 'Users' })).getByRole('button', {
        name: /Projects/,
      }),
    );

    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith({
        search: 'bob',
        role: 'Support',
        is_active: false,
        is_staff: true,
        sort: 'active_projects',
        limit: 25,
        offset: 0,
      }),
    );
  });

  it('pages through a long list', async () => {
    const { listUsers } = setup(SUPPORT, [makeAdminUser()], 60);
    await screen.findByText('1 to 25 of 60');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })),
    );
  });
});

describe('the role select', () => {
  it('is hidden without users.roles.assign', async () => {
    setup(SUPPORT);
    fireEvent.click(await userRow('bob@example.com'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
    expect(within(dialog).queryByText('Roles')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Support' })).not.toBeInTheDocument();
  });

  it('is shown with it, and its choice is saved', async () => {
    const { updateUser } = setup(ADMIN);
    fireEvent.click(await userRow('bob@example.com'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Support' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(2, {
        name: 'Bob',
        email: 'bob@example.com',
        is_staff: false,
        roles: ['Support'],
      }),
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved.');
  });

  it('is left out of the save of someone without the permission', async () => {
    const { updateUser } = setup(SUPPORT);
    fireEvent.click(await userRow('bob@example.com'));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    expect(updateUser.mock.calls[0]![1]).not.toHaveProperty('roles');
  });
});

describe('the detail', () => {
  it('deactivates after a confirmation, and closes', async () => {
    const { updateUser } = setup(SUPPORT);
    fireEvent.click(await userRow('bob@example.com'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /^Deactivate/ }));
    expect(updateUser).not.toHaveBeenCalled();
    // The confirmation is its own alert dialog, on top of the user's.
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: /Confirm deactivate/ }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(2, { is_active: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers to activate an inactive account, and no password reset', async () => {
    setup(SUPPORT, [makeAdminUser({ is_active: false })]);
    fireEvent.click(await userRow('bob@example.com'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /^Activate/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Send password reset' })).toBeNull();
  });

  it('does not offer to deactivate yourself', async () => {
    setup(SUPPORT, [makeAdminUser({ id: SUPPORT.id, email: SUPPORT.email })]);
    fireEvent.click(await userRow(SUPPORT.email));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
  });

  it('sends a password reset', async () => {
    const { resetUserPassword } = setup(SUPPORT);
    fireEvent.click(await userRow('bob@example.com'));
    fireEvent.click(await screen.findByRole('button', { name: 'Send password reset' }));

    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith(2));
    expect(await screen.findByText('A password reset email was sent.')).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    const { updateUser } = setup(SUPPORT);
    updateUser.mockRejectedValue(
      new ApiError(400, { detail: 'This is the last active superuser.' }),
    );
    fireEvent.click(await userRow('bob@example.com'));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    expect(await screen.findByText('This is the last active superuser.')).toBeInTheDocument();
  });
});

describe('the invite dialog', () => {
  it('is only for those who may manage users', async () => {
    setup(makeUser({ permissions: ['users.view'] }));
    await screen.findByRole('table', { name: 'Users' });
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
  });

  it('sends the invite, with roles for someone who may assign them', async () => {
    const { inviteUser } = setup(ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Support' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));

    await waitFor(() =>
      expect(inviteUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: '',
        is_staff: false,
        roles: ['Support'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows what the server said about the email', async () => {
    const { inviteUser } = setup(SUPPORT);
    inviteUser.mockRejectedValue(
      new ApiError(400, { email: ['An account with this email already exists.'] }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
  });
});
