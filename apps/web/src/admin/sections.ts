import type { User } from '../api/client';
import { userCan } from '../auth/can';

export type Section = {
  path: string;
  label: string;
  /** The permission that opens the section. */
  permission: string;
  /** Holding any one of these opens it too, for a section that spans several permissions. */
  alsoWith?: string[];
  /** Not built yet: shown disabled, with "Coming soon". */
  soon?: boolean;
};

export const SECTIONS: Section[] = [
  { path: 'catalog', label: 'Catalog', permission: 'config.catalog.edit' },
  { path: 'rules', label: 'Rules', permission: 'config.rules.edit' },
  { path: 'app', label: 'App settings', permission: 'config.app.edit' },
  { path: 'quotes', label: 'Quotes', permission: 'config.quote.edit' },
  {
    path: 'backup',
    label: 'Backup and reset',
    permission: 'config.catalog.edit',
    alsoWith: ['config.rules.edit', 'config.app.edit', 'config.quote.edit'],
  },
  { path: 'ai', label: 'AI', permission: 'llm.settings.edit' },
  { path: 'users', label: 'Users', permission: 'users.view' },
  { path: 'roles', label: 'Roles', permission: 'users.view' },
  { path: 'audit', label: 'Audit', permission: 'audit.view' },
];

/** Whether the user may open the section. The server enforces it as well. */
export const canOpen = (user: User | null | undefined, section: Section): boolean =>
  [section.permission, ...(section.alsoWith ?? [])].some((code) => userCan(user, code));
