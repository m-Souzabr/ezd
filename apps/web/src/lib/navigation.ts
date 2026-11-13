import type { LucideIcon } from 'lucide-react';

import type { User } from '@/api/client';
import { userCan } from '@/auth/can';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** A Control Panel permission code the user must hold to see the item. */
  permission?: string;
  /** Only staff see the item. */
  staffOnly?: boolean;
};

/** The most items a phone's bottom bar shows; the bar has no room for more. */
export const MAX_BOTTOM_ITEMS = 5;

/** The items this user may see, in order. Anyone signed out sees only the unrestricted ones. */
export function visibleNavItems(items: NavItem[], user: User | null | undefined): NavItem[] {
  return items.filter(
    (item) =>
      (!item.staffOnly || !!user?.is_staff) &&
      (item.permission === undefined || userCan(user, item.permission)),
  );
}

/** Whether `to` is the current page or an ancestor of it; `/` is only the home page itself. */
export function isActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}
