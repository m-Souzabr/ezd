import { useState } from 'react';
import { LogInIcon, LogOutIcon, UserPlusIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { ResponsiveMenu, type MenuAction } from '@/components/patterns/responsive-menu';
import { ThemeToggle } from '@/components/patterns/theme-toggle';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useSession } from '@/auth/session';
import { useSignOut } from '@/auth/useSignOut';
import { useMediaQuery } from '@/hooks/use-media-query';
import { LG_UP } from '@/lib/breakpoints';
import { isActivePath, MAX_BOTTOM_ITEMS, visibleNavItems, type NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

type AppShellProps = {
  items: NavItem[];
  appName?: string;
};

/** The account in the sidebar footer: who is signed in and the way out, or the way in. */
function SidebarAccount() {
  const user = useSession();
  const signOut = useSignOut();
  if (user === undefined) return null;
  if (user === null) {
    return (
      <nav aria-label="Account" className="flex flex-col gap-1">
        <Link
          to="/login"
          aria-label="Sign in"
          className={buttonVariants({ variant: 'ghost', className: 'justify-start' })}
        >
          <LogInIcon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">Sign in</span>
        </Link>
        <Link
          to="/register"
          aria-label="Create account"
          className={buttonVariants({ variant: 'ghost', className: 'justify-start' })}
        >
          <UserPlusIcon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">Create account</span>
        </Link>
      </nav>
    );
  }
  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      <p className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        {user.email}
      </p>
      <Button variant="ghost" className="justify-start" aria-label="Sign out" onClick={signOut}>
        <LogOutIcon aria-hidden="true" />
        <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
      </Button>
    </nav>
  );
}

/** The account in a phone's header, where the sidebar is not shown. */
function HeaderAccount() {
  const user = useSession();
  const signOut = useSignOut();
  if (user === undefined) return null;
  if (user === null) {
    return (
      <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
        Sign in
      </Link>
    );
  }
  const actions: MenuAction[] = [
    {
      id: 'sign-out',
      label: 'Sign out',
      icon: <LogOutIcon aria-hidden="true" />,
      onSelect: signOut,
    },
  ];
  return <ResponsiveMenu label="Account" actions={actions} />;
}

/**
 * The frame of the app. A phone shows a bottom tab bar (at most five items), a tablet an
 * icon-only sidebar and a desktop a full sidebar that the trigger collapses. The caller passes
 * the items; the shell hides the ones the user lacks the permission for.
 */
export function AppShell({ items, appName = 'EZDesign' }: AppShellProps) {
  const isLgUp = useMediaQuery(LG_UP);
  const [expanded, setExpanded] = useState(true);
  const { pathname } = useLocation();
  const visible = visibleNavItems(items, useSession());

  return (
    <SidebarProvider open={isLgUp && expanded} onOpenChange={setExpanded}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <Sidebar collapsible="icon">
        <SidebarHeader>
          <span className="truncate px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden">
            {appName}
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {visible.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={isActivePath(pathname, item.to)}
                      tooltip={item.label}
                      render={<NavLink to={item.to} end={item.to === '/'} />}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarAccount />
          <ThemeToggle />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 md:px-6 lg:px-8">
          <SidebarTrigger className="hidden lg:inline-flex" />
          <span className="font-semibold md:hidden">{appName}</span>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <HeaderAccount />
            <ThemeToggle />
          </div>
        </header>
        {/* SidebarInset is already the page's `main` landmark; this is the skip link's target. */}
        <div
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-24 outline-none md:px-6 md:pb-6 lg:px-8"
        >
          <Outlet />
        </div>
      </SidebarInset>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-safe md:hidden"
      >
        <ul className="flex">
          {visible.slice(0, MAX_BOTTOM_ITEMS).map((item) => {
            const active = isActivePath(pathname, item.to);
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 text-xs',
                    active ? 'font-medium text-primary' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="size-5" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </SidebarProvider>
  );
}
