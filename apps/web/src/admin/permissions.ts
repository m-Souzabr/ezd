import type { PermissionCode } from '../api/client';

/** The Control Panel's permission codes with what each lets a role do, as the server lists them. */
export const PERMISSIONS: { code: PermissionCode; label: string }[] = [
  { code: 'config.catalog.edit', label: 'Edit the catalog' },
  { code: 'config.catalog.publish', label: 'Publish the catalog' },
  { code: 'config.rules.edit', label: 'Edit the rules' },
  { code: 'config.app.edit', label: 'Edit the app settings' },
  { code: 'config.quote.edit', label: 'Edit the quote defaults' },
  { code: 'llm.settings.edit', label: 'Edit the AI settings' },
  { code: 'users.view', label: 'View users' },
  { code: 'users.manage', label: 'Manage users' },
  { code: 'users.roles.assign', label: 'Assign roles' },
  { code: 'users.roles.manage', label: 'Manage roles' },
  { code: 'audit.view', label: 'View the audit log' },
];

export const permissionLabel = (code: string): string =>
  PERMISSIONS.find((permission) => permission.code === code)?.label ?? code;
