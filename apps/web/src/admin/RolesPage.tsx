import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { api, type PermissionCode, type Role } from '../api/client';
import { adminRolesKey } from '../api/keys';
import { useCan } from '../auth/can';
import { RequirePermission } from '../auth/permissions';
import { useSession } from '../auth/session';
import { userCan } from '../auth/can';
import { FormError } from '../components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataList, type DataListColumn } from '@/components/patterns/data-list';
import { PageHeader } from '@/components/patterns/page-header';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NoAccess } from './AdminLayout';
import { permissionLabel, PERMISSIONS } from './permissions';

/** A role being made (`role` is null) or changed. The permissions you do not hold are off limits. */
function RoleDialog({ role, onClose }: { role: Role | null; onClose(): void }) {
  const queryClient = useQueryClient();
  const me = useSession();
  const nameId = useId();
  const formId = useId();
  const [name, setName] = useState(role?.name ?? '');
  const [held, setHeld] = useState<PermissionCode[]>((role?.permissions ?? []) as PermissionCode[]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), permissions: held };
      return role ? api.updateRole(role.id, body) : api.createRole(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminRolesKey });
      onClose();
    },
  });
  const toggle = (code: PermissionCode, on: boolean) =>
    setHeld((current) => (on ? [...current, code] : current.filter((item) => item !== code)));
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={role ? `Edit ${role.name}` : 'New role'}
      description="A role gives its members these permissions from their next request. You can only give a permission you hold yourself."
      showCloseButton={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending || name.trim() === ''}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            maxLength={150}
            required
            aria-invalid={save.error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Permissions</legend>
          {PERMISSIONS.map(({ code, label }) => {
            const allowed = userCan(me, code);
            return (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={held.includes(code)}
                  // Removing a permission you lack is allowed; adding one is not.
                  disabled={!allowed && !held.includes(code)}
                  onChange={(event) => toggle(code, event.target.checked)}
                />
                {label}
                {!allowed && (
                  <span className="text-xs text-muted-foreground">(you do not hold it)</span>
                )}
              </label>
            );
          })}
        </fieldset>
        <FormError error={save.error} />
      </form>
    </ResponsiveDialog>
  );
}

function DeleteDialog({ role, onClose }: { role: Role; onClose(): void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteRole(role.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminRolesKey });
    },
  });
  return (
    <>
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={`Delete ${role.name}?`}
        description={
          role.members > 0
            ? `${role.members} ${role.members === 1 ? 'person holds' : 'people hold'} this role and will lose what it gives them on their next request.`
            : 'Nobody holds this role.'
        }
        confirmLabel="Delete role"
        onConfirm={() => remove.mutate()}
      />
      <FormError error={remove.error} />
    </>
  );
}

function Roles() {
  const canManage = useCan('users.roles.manage');
  const roles = useQuery({ queryKey: adminRolesKey, queryFn: api.listRoles });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const columns: DataListColumn<Role>[] = [
    {
      id: 'name',
      primary: true,
      header: 'Role',
      cell: (role) => (
        <span className="flex flex-wrap items-center gap-2">
          {role.name}
          {role.protected && <Badge variant="secondary">Protected</Badge>}
        </span>
      ),
    },
    {
      id: 'permissions',
      header: 'Permissions',
      cell: (role) => (
        <span className="block max-w-prose whitespace-normal">
          {role.permissions.length > 0 ? role.permissions.map(permissionLabel).join(', ') : 'None'}
        </span>
      ),
    },
    { id: 'members', header: 'Members', cell: (role) => role.members },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (role: Role) =>
              role.protected ? (
                <span className="text-xs text-muted-foreground">Cannot be changed</span>
              ) : (
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${role.name}`}
                    onClick={() => setEditing(role)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${role.name}`}
                    onClick={() => setDeleting(role)}
                  >
                    Delete
                  </Button>
                </span>
              ),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Roles"
        description="What each role may do. The seeded roles are protected."
        actions={
          canManage && (
            <Button type="button" onClick={() => setEditing('new')}>
              New role
            </Button>
          )
        }
      />
      {roles.isPending ? (
        <LoadingState label="Loading roles" />
      ) : roles.error ? (
        <ErrorState
          title="The roles could not be loaded"
          description={roles.error.message}
          onRetry={() => void roles.refetch()}
        />
      ) : roles.data.length === 0 ? (
        <EmptyState title="No roles" description="There are no roles yet." />
      ) : (
        <DataList
          caption="Roles"
          rows={roles.data}
          columns={columns}
          getRowId={(role) => String(role.id)}
        />
      )}
      {editing && (
        <RoleDialog role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteDialog role={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

export function RolesPage() {
  return (
    <RequirePermission permission="users.view" fallback={<NoAccess />}>
      <Roles />
    </RequirePermission>
  );
}
