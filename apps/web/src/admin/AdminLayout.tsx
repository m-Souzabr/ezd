import { useState } from 'react';
import { ArrowLeftIcon, LogOutIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { useSession } from '@/auth/session';
import { useSignOut } from '@/auth/useSignOut';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
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
import { useMediaQuery } from '@/hooks/use-media-query';
import { LG_UP } from '@/lib/breakpoints';
import { isActivePath } from '@/lib/navigation';
import { canOpen, SECTIONS } from './sections';

/** What a section shows to a user who may not use it. The server refuses them as well. */
export function NoAccess() {
  return <p className="text-sm text-muted-foreground">Your role does not include this section.</p>;
}

/**
 * The Control Panel's frame: a sidebar of the sections the user may open (full on a desktop,
 * icons only on a tablet, a sheet from the header button on a phone), a breadcrumb, the page.
 */
export function AdminLayout() {
  const user = useSession();
  const signOut = useSignOut();
  const isLgUp = useMediaQuery(LG_UP);
  const [expanded, setExpanded] = useState(true);
  const { pathname } = useLocation();
  const visible = SECTIONS.filter((section) => canOpen(user, section));
  const current = SECTIONS.find((section) => isActivePath(pathname, `/admin/${section.path}`));

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
            EZDesign Control Panel
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Control Panel">
                <SidebarMenu>
                  {visible.map((section) => (
                    <SidebarMenuItem key={section.path}>
                      <SidebarMenuButton
                        isActive={isActivePath(pathname, `/admin/${section.path}`)}
                        tooltip={section.label}
                        render={<NavLink to={`/admin/${section.path}`} />}
                      >
                        <section.icon aria-hidden="true" />
                        <span>{section.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <nav aria-label="Account" className="flex flex-col gap-1">
            <Link
              to="/projects"
              aria-label="Back to the app"
              className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-sm hover:bg-sidebar-accent"
            >
              <ArrowLeftIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="group-data-[collapsible=icon]:hidden">Back to the app</span>
            </Link>
            {user && (
              <>
                <p className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {user.email}
                </p>
                <Button
                  variant="ghost"
                  className="justify-start"
                  aria-label="Sign out"
                  onClick={signOut}
                >
                  <LogOutIcon aria-hidden="true" />
                  <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
                </Button>
              </>
            )}
          </nav>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:px-6 lg:px-8">
          {/* A sheet on a phone, a collapse on a desktop; a tablet's sidebar stays icon-only. */}
          <SidebarTrigger className="md:max-lg:hidden" aria-label="Toggle the sections" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {current ? (
                  <BreadcrumbLink render={<Link to="/admin" />}>Control Panel</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>Control Panel</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {current && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-x-auto px-4 py-6 outline-none md:px-6 lg:px-8"
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
