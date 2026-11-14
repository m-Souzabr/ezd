import {
  ArchiveRestoreIcon,
  BoxesIcon,
  ReceiptTextIcon,
  RulerIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

import type { User } from '../api/client';
import { userCan } from '../auth/can';

export type Section = {
  path: string;
  label: string;
  /** What the section is for, on its card on the Control Panel's home page. */
  description: string;
  icon: LucideIcon;
  /** The permission that opens the section. */
  permission: string;
  /** Holding any one of these opens it too, for a section that spans several permissions. */
  alsoWith?: string[];
  /** Not built yet: shown disabled, with "Coming soon". */
  soon?: boolean;
};

export const SECTIONS: Section[] = [
  {
    path: 'catalog',
    label: 'Catalog',
    description: 'Cabinets, prices and finishes, as a draft you publish.',
    icon: BoxesIcon,
    permission: 'config.catalog.edit',
  },
  {
    path: 'rules',
    label: 'Rules',
    description: 'Which design checks run, how serious they are, and their limits.',
    icon: RulerIcon,
    permission: 'config.rules.edit',
  },
  {
    path: 'app',
    label: 'App settings',
    description: 'Panels, features, toolbar, viewport, theme and help text.',
    icon: SlidersHorizontalIcon,
    permission: 'config.app.edit',
  },
  {
    path: 'quotes',
    label: 'Quotes',
    description: 'The rates a new quote starts from, and its company branding.',
    icon: ReceiptTextIcon,
    permission: 'config.quote.edit',
  },
  {
    path: 'backup',
    label: 'Backup and reset',
    description: 'Export or import the configuration, or put a section back to its defaults.',
    icon: ArchiveRestoreIcon,
    permission: 'config.catalog.edit',
    alsoWith: ['config.rules.edit', 'config.app.edit', 'config.quote.edit'],
  },
  {
    path: 'ai',
    label: 'AI',
    description: 'The assistant: its provider key, models and monthly limits.',
    icon: SparklesIcon,
    permission: 'llm.settings.edit',
  },
  {
    path: 'users',
    label: 'Users',
    description: 'Accounts: invite, change, deactivate and assign roles.',
    icon: UsersIcon,
    permission: 'users.view',
  },
  {
    path: 'roles',
    label: 'Roles',
    description: 'What each role may do, and custom roles of your own.',
    icon: ShieldCheckIcon,
    permission: 'users.view',
  },
  {
    path: 'audit',
    label: 'Audit',
    description: 'Every change made in the Control Panel, who made it and when.',
    icon: ScrollTextIcon,
    permission: 'audit.view',
  },
];

/** Whether the user may open the section. The server enforces it as well. */
export const canOpen = (user: User | null | undefined, section: Section): boolean =>
  [section.permission, ...(section.alsoWith ?? [])].some((code) => userCan(user, code));
