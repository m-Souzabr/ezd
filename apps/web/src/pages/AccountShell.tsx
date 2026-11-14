import { FolderIcon, PencilRulerIcon, ShieldIcon } from 'lucide-react';

import { AppShell } from '@/components/patterns/app-shell';
import { useConfig } from '@/config/useConfig';
import type { NavItem } from '@/lib/navigation';

/**
 * The frame of the account pages, with navigation from the routes the app has. The shell hides
 * what the user lacks the permission for; the quick editor is there only while the
 * configuration allows it.
 */
export function AccountShell() {
  const { localEditor } = useConfig().features;
  const items: NavItem[] = [
    { to: '/projects', label: 'Projects', icon: FolderIcon },
    { to: '/admin', label: 'Admin', icon: ShieldIcon, staffOnly: true },
    ...(localEditor ? [{ to: '/', label: 'Quick editor', icon: PencilRulerIcon }] : []),
  ];
  return <AppShell items={items} />;
}
