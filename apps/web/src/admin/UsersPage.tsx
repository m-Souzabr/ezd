import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { api, type AdminUser, type AdminUserCreate, type AdminUserUpdate } from '../api/client';
import { adminRolesKey, adminUsersKey } from '../api/keys';
import { useCan } from '../auth/can';
import { RequirePermission } from '../auth/permissions';
import { useSession } from '../auth/session';
import { BUTTON } from '../editor/panels/fields';
import { fieldErrors, formatDate } from '../pages/format';
import { CloseButton, Modal } from '../pages/Modal';
import { formatSort, parseSort, type Sort } from '../pages/sort';
import { Table, type Column } from '../pages/Table';
import { ConfirmButton, FormError, LINK, PRIMARY, TextField } from '../pages/ui';
import { NoAccess } from './AdminLayout';
import { FIELD, Pager } from './controls';

const PAGE_SIZE = 25;

/** The roles as checkboxes. Not rendered at all without `users.roles.assign`. */
function RoleSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange(roles: string[]): void;
}) {
  const roles = useQuery({ queryKey: adminRolesKey, queryFn: api.listRoles });
  return (
    <RequirePermission permission="users.roles.assign">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-slate-700">Roles</legend>
        {roles.data?.map((role) => (
          <label key={role.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(role.name)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, role.name]
                    : selected.filter((name) => name !== role.name),
                )
              }
            />
            {role.name}
          </label>
        ))}
      </fieldset>
    </RequirePermission>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const queryClient = useQueryClient();
  const canAssign = useCan('users.roles.assign');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [staff, setStaff] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const invite = useMutation({
    mutationFn: (body: AdminUserCreate) => api.inviteUser(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminUsersKey() });
      setEmail('');
      setName('');
      setStaff(false);
      setRoles([]);
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate({ email: email.trim(), name: name.trim(), is_staff: staff, roles });
  };
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          invite.reset();
          onClose();
        }
      }}
      title="Invite a user"
      description="They get an email with a link to choose a password."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          errors={fieldErrors(invite.error, 'email')}
        />
        <TextField label="Name" value={name} onChange={setName} required={false} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={staff} onChange={(e) => setStaff(e.target.checked)} />
          Staff: can open the Control Panel
        </label>
        {canAssign && <RoleSelect selected={roles} onChange={setRoles} />}
        <FormError error={invite.error} fields={['email']} />
        <div className="flex justify-end gap-2">
          <CloseButton label="Cancel" />
          <button type="submit" className={PRIMARY} disabled={invite.isPending}>
            Send invite
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Detail({ user, onClose }: { user: AdminUser; onClose(): void }) {
  const queryClient = useQueryClient();
  const me = useSession();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [staff, setStaff] = useState(user.is_staff);
  const [roles, setRoles] = useState(user.roles);
  const [notice, setNotice] = useState<string | null>(null);
  const isMe = me?.id === user.id;

  const update = useMutation({
    mutationFn: (body: AdminUserUpdate) => api.updateUser(user.id, body),
    onSuccess: (next, body) => {
      void queryClient.invalidateQueries({ queryKey: adminUsersKey() });
      setNotice(
        body.is_active === undefined ? 'Saved.' : next.is_active ? 'Activated.' : 'Deactivated.',
      );
      if (body.is_active !== undefined) onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => api.resetUserPassword(user.id),
    onSuccess: () => setNotice('A password reset email was sent.'),
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    update.mutate({
      name: name.trim(),
      email: email.trim(),
      is_staff: staff,
      // Without the permission the server would refuse any list of roles.
      ...(me && (me.is_superuser || me.permissions.includes('users.roles.assign')) && { roles }),
    });
  };
  const error = update.error ?? reset.error;

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <TextField label="Name" value={name} onChange={setName} required={false} />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={staff}
          disabled={isMe}
          onChange={(event) => setStaff(event.target.checked)}
        />
        Staff: can open the Control Panel
      </label>
      <RoleSelect selected={roles} onChange={setRoles} />
      <dl className="grid grid-cols-2 gap-1 text-xs text-slate-600">
        <dt>Last sign-in</dt>
        <dd>{user.last_login ? formatDate(user.last_login) : 'Never'}</dd>
        <dt>Joined</dt>
        <dd>{formatDate(user.date_joined)}</dd>
        <dt>Projects</dt>
        <dd>{user.active_projects}</dd>
        <dt>Assistant tokens this month</dt>
        <dd>{user.chat_tokens_this_month.toLocaleString()}</dd>
      </dl>
      <FormError error={error} />
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={update.isPending}>
          Save
        </button>
        {user.is_active && (
          <button
            type="button"
            className={BUTTON}
            disabled={reset.isPending}
            onClick={() => {
              setNotice(null);
              reset.mutate();
            }}
          >
            Send password reset
          </button>
        )}
        {user.is_active ? (
          !isMe && (
            <ConfirmButton
              label="Deactivate"
              what={user.email}
              onConfirm={() => update.mutate({ is_active: false })}
            />
          )
        ) : (
          <ConfirmButton
            label="Activate"
            what={user.email}
            onConfirm={() => update.mutate({ is_active: true })}
          />
        )}
        <span className="ml-auto">
          <CloseButton />
        </span>
      </div>
    </form>
  );
}

function Users() {
  const canManage = useCan('users.manage');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [staff, setStaff] = useState('');
  const [sort, setSort] = useState<Sort>(parseSort('email'));
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [inviting, setInviting] = useState(false);

  const params = {
    search: search.trim(),
    role,
    ...(active && { is_active: active === 'yes' }),
    ...(staff && { is_staff: staff === 'yes' }),
    sort: formatSort(sort),
    limit: PAGE_SIZE,
    offset,
  };
  const users = useQuery({ queryKey: adminUsersKey(params), queryFn: () => api.listUsers(params) });
  const roles = useQuery({ queryKey: adminRolesKey, queryFn: api.listRoles });
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  const columns: Column<AdminUser>[] = [
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      cell: (user) => (
        <button type="button" className={LINK} onClick={() => setSelected(user)}>
          {user.email}
        </button>
      ),
    },
    { key: 'name', header: 'Name', sortable: true, cell: (user) => user.name || '—' },
    {
      key: 'roles',
      header: 'Roles',
      cell: (user) =>
        user.is_superuser ? 'Superuser' : user.roles.length > 0 ? user.roles.join(', ') : '—',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (user) => `${user.is_active ? 'Active' : 'Inactive'}${user.is_staff ? ', staff' : ''}`,
    },
    {
      key: 'last_login',
      header: 'Last sign-in',
      sortable: true,
      cell: (user) => (user.last_login ? formatDate(user.last_login) : 'Never'),
    },
    {
      key: 'active_projects',
      header: 'Projects',
      sortable: true,
      cell: (user) => user.active_projects,
    },
    {
      key: 'chat_tokens',
      header: 'Tokens this month',
      sortable: true,
      cell: (user) => user.chat_tokens_this_month.toLocaleString(),
    },
  ];

  return (
    <>
      <div className="mb-4 flex items-center">
        <h1 className="text-xl font-semibold">Users</h1>
        {canManage && (
          <button type="button" className={`${PRIMARY} ml-auto`} onClick={() => setInviting(true)}>
            Invite user
          </button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Search
          <input
            className={FIELD}
            value={search}
            placeholder="Email or name"
            onChange={(event) => filter(setSearch)(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Role
          <select
            className={FIELD}
            value={role}
            onChange={(event) => filter(setRole)(event.target.value)}
          >
            <option value="">Any</option>
            {roles.data?.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Active
          <select
            className={FIELD}
            value={active}
            onChange={(event) => filter(setActive)(event.target.value)}
          >
            <option value="">Any</option>
            <option value="yes">Active</option>
            <option value="no">Inactive</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Staff
          <select
            className={FIELD}
            value={staff}
            onChange={(event) => filter(setStaff)(event.target.value)}
          >
            <option value="">Any</option>
            <option value="yes">Staff</option>
            <option value="no">Not staff</option>
          </select>
        </label>
      </div>
      <Table
        label="Users"
        columns={columns}
        rows={users.data?.rows}
        rowKey={(user) => user.id}
        sort={sort}
        onSort={(next) => {
          setSort(next);
          setOffset(0);
        }}
        loading={users.isPending}
        error={users.error?.message ?? null}
        empty="No users match."
      />
      <Pager
        offset={offset}
        limit={PAGE_SIZE}
        total={users.data?.total ?? 0}
        onOffset={setOffset}
      />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <Modal
        open={selected !== null}
        onOpenChange={(next) => !next && setSelected(null)}
        title={selected?.email ?? 'User'}
        {...(selected && !selected.is_active && { description: 'This account is deactivated.' })}
      >
        {selected && (
          <Detail
            // A new key resets the form for each user opened.
            key={selected.id}
            user={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  );
}

export function UsersPage() {
  return (
    <RequirePermission permission="users.view" fallback={<NoAccess />}>
      <Users />
    </RequirePermission>
  );
}
