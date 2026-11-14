import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { api, type PermissionCode, type Role } from '../api/client';
import { adminRolesKey } from '../api/keys';
import { useCan } from '../auth/can';
import { RequirePermission } from '../auth/permissions';
import { useSession } from '../auth/session';
import { userCan } from '../auth/can';
import { FormError } from '../components/form-error';
import { CloseButton, Modal } from '../pages/Modal';
import { Table, type Column } from '../pages/Table';
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
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={role ? `Edit ${role.name}` : 'New role'}
      description="A role gives its members these permissions from their next request. You can only give a permission you hold yourself."
    >
      <form
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
        <div className="flex justify-end gap-2">
          <CloseButton label="Cancel" />
          <Button type="submit" disabled={save.isPending || name.trim() === ''}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ role, onClose }: { role: Role; onClose(): void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteRole(role.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminRolesKey });
      onClose();
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${role.name}?`}
      description={
        role.members > 0
          ? `${role.members} ${role.members === 1 ? 'person holds' : 'people hold'} this role and will lose what it gives them on their next request.`
          : 'Nobody holds this role.'
      }
    >
      <FormError error={remove.error} />
      <div className="flex justify-end gap-2">
        <CloseButton label="Cancel" />
        <Button
          type="button"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete role
        </Button>
      </div>
    </Modal>
  );
}

function Roles() {
  const canManage = useCan('users.roles.manage');
  const roles = useQuery({ queryKey: adminRolesKey, queryFn: api.listRoles });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (role) => (
        <span className="flex flex-wrap items-center gap-2">
          {role.name}
          {role.protected && <Badge variant="secondary">Protected</Badge>}
        </span>
      ),
    },
    {
      key: 'permissions',
      header: 'Permissions',
      cell: (role) =>
        role.permissions.length > 0 ? role.permissions.map(permissionLabel).join(', ') : 'None',
    },
    { key: 'members', header: 'Members', cell: (role) => role.members },
    ...(canManage
      ? [
          {
            key: 'actions',
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
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Roles</h1>
        {canManage && (
          <Button type="button" className="ml-auto" onClick={() => setEditing('new')}>
            New role
          </Button>
        )}
      </div>
      <Table
        label="Roles"
        columns={columns}
        rows={roles.data}
        rowKey={(role) => role.id}
        loading={roles.isPending}
        error={roles.error?.message ?? null}
      />
      {editing && (
        <RoleDialog role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteDialog role={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

export function RolesPage() {
  return (
    <RequirePermission permission="users.view" fallback={<NoAccess />}>
      <Roles />
    </RequirePermission>
  );
}
