import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { api, type AdminUser, type AdminUserCreate, type AdminUserUpdate } from '@/api/client';
import { adminRolesKey, adminUsersKey } from '@/api/keys';
import { useCan } from '@/auth/can';
import { RequirePermission } from '@/auth/permissions';
import { useSession } from '@/auth/session';
import { FormError } from '@/components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataList, type DataListColumn, type DataListSort } from '@/components/patterns/data-list';
import { PageHeader } from '@/components/patterns/page-header';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { fieldErrors, formatDate } from '@/pages/format';
import { formatSort, parseSort } from '@/pages/sort';
import { CheckField, TextField } from './AdminFields';
import { NoAccess } from './AdminLayout';
import { Pager } from './Pager';

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
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        {roles.data?.map((role) => (
          <CheckField
            key={role.name}
            label={role.name}
            checked={selected.includes(role.name)}
            onChange={(on) =>
              onChange(
                on ? [...selected, role.name] : selected.filter((name) => name !== role.name),
              )
            }
          />
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
  const formId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate({ email: email.trim(), name: name.trim(), is_staff: staff, roles });
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          invite.reset();
          onClose();
        }
      }}
      title="Invite a user"
      description="They get an email with a link to choose a password."
      showCloseButton={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={invite.isPending}>
            Send invite
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          errors={fieldErrors(invite.error, 'email')}
        />
        <TextField label="Name" value={name} onChange={setName} required={false} />
        <CheckField label="Staff: can open the Control Panel" checked={staff} onChange={setStaff} />
        {canAssign && <RoleSelect selected={roles} onChange={setRoles} />}
        <FormError error={invite.error} fields={['email']} />
      </form>
    </ResponsiveDialog>
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
  const [confirming, setConfirming] = useState(false);
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
  const verb = user.is_active ? 'Deactivate' : 'Activate';

  return (
    <form onSubmit={save} className="flex flex-col gap-4 pb-4">
      <TextField label="Name" value={name} onChange={setName} required={false} />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
      <CheckField
        label="Staff: can open the Control Panel"
        checked={staff}
        disabled={isMe}
        onChange={setStaff}
      />
      <RoleSelect selected={roles} onChange={setRoles} />
      <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
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
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
        {user.is_active && (
          <Button
            variant="outline"
            type="button"
            disabled={reset.isPending}
            onClick={() => {
              setNotice(null);
              reset.mutate();
            }}
          >
            Send password reset
          </Button>
        )}
        {(!user.is_active || !isMe) && (
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            {verb}
            <span className="sr-only"> {user.email}</span>
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${verb} ${user.email}?`}
        description={
          user.is_active
            ? 'They are signed out everywhere and cannot sign in until they are activated again.'
            : 'They can sign in again.'
        }
        confirmLabel={`Confirm ${verb.toLowerCase()}`}
        onConfirm={() => update.mutate({ is_active: !user.is_active })}
      />
    </form>
  );
}

function Users() {
  const canManage = useCan('users.manage');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [staff, setStaff] = useState('');
  const [sort, setSort] = useState(parseSort('email'));
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [inviting, setInviting] = useState(false);
  const ids = useId();

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

  const columns: DataListColumn<AdminUser>[] = [
    {
      id: 'email',
      header: 'Email',
      sortable: true,
      primary: true,
      cell: (user) => (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={() => setSelected(user)}
        >
          {user.email}
        </Button>
      ),
    },
    { id: 'name', header: 'Name', sortable: true, cell: (user) => user.name || '—' },
    {
      id: 'roles',
      header: 'Roles',
      cell: (user) =>
        user.is_superuser ? 'Superuser' : user.roles.length > 0 ? user.roles.join(', ') : '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (user) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={user.is_active ? 'success' : 'secondary'}>
            {user.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {user.is_staff && <Badge variant="outline">Staff</Badge>}
        </span>
      ),
    },
    {
      id: 'last_login',
      header: 'Last sign-in',
      sortable: true,
      desktopOnly: true,
      cell: (user) => (user.last_login ? formatDate(user.last_login) : 'Never'),
    },
    {
      id: 'active_projects',
      header: 'Projects',
      sortable: true,
      desktopOnly: true,
      cell: (user) => user.active_projects,
    },
    {
      id: 'chat_tokens',
      header: 'Tokens this month',
      sortable: true,
      desktopOnly: true,
      cell: (user) => user.chat_tokens_this_month.toLocaleString(),
    },
  ];
  const dataSort: DataListSort = { id: sort.key, descending: sort.descending };
  const label = 'flex flex-col gap-1.5 text-sm text-muted-foreground';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        description="Every account, with its roles and this month's use."
        actions={
          canManage && (
            <Button type="button" onClick={() => setInviting(true)}>
              Invite user
            </Button>
          )
        }
      />
      <form
        aria-label="Filter the users"
        className="flex flex-wrap gap-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className={label} htmlFor={`${ids}-search`}>
          Search
          <Input
            id={`${ids}-search`}
            value={search}
            placeholder="Email or name"
            onChange={(event) => filter(setSearch)(event.target.value)}
          />
        </label>
        <label className={label} htmlFor={`${ids}-role`}>
          Role
          <NativeSelect
            id={`${ids}-role`}
            value={role}
            onChange={(event) => filter(setRole)(event.target.value)}
          >
            <option value="">Any</option>
            {roles.data?.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </NativeSelect>
        </label>
        <label className={label} htmlFor={`${ids}-active`}>
          Active
          <NativeSelect
            id={`${ids}-active`}
            value={active}
            onChange={(event) => filter(setActive)(event.target.value)}
          >
            <option value="">Any</option>
            <option value="yes">Active</option>
            <option value="no">Inactive</option>
          </NativeSelect>
        </label>
        <label className={label} htmlFor={`${ids}-staff`}>
          Staff
          <NativeSelect
            id={`${ids}-staff`}
            value={staff}
            onChange={(event) => filter(setStaff)(event.target.value)}
          >
            <option value="">Any</option>
            <option value="yes">Staff</option>
            <option value="no">Not staff</option>
          </NativeSelect>
        </label>
      </form>
      {users.isPending ? (
        <LoadingState label="Loading users" />
      ) : users.error ? (
        <ErrorState
          title="The users could not be loaded"
          description={users.error.message}
          onRetry={() => void users.refetch()}
        />
      ) : users.data.rows.length === 0 ? (
        <EmptyState title="No users match" description="Change the search or the filters." />
      ) : (
        <DataList
          caption="Users"
          rows={users.data.rows}
          columns={columns}
          getRowId={(user) => String(user.id)}
          sort={dataSort}
          onSortChange={(next) => {
            setSort({ key: next.id, descending: next.descending });
            setOffset(0);
          }}
        />
      )}
      <Pager
        offset={offset}
        limit={PAGE_SIZE}
        total={users.data?.total ?? 0}
        onOffset={setOffset}
      />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ResponsiveDialog
        open={selected !== null}
        onOpenChange={(next) => !next && setSelected(null)}
        title={selected?.email ?? 'User'}
        description={
          selected && !selected.is_active ? 'This account is deactivated.' : 'Change this account.'
        }
      >
        {selected && (
          <Detail
            // A new key resets the form for each user opened.
            key={selected.id}
            user={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </ResponsiveDialog>
    </div>
  );
}

export function UsersPage() {
  return (
    <RequirePermission permission="users.view" fallback={<NoAccess />}>
      <Users />
    </RequirePermission>
  );
}
