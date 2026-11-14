import { Link, NavLink, Outlet } from 'react-router';

import { useSession } from '../auth/session';
import { AccountLinks } from '../pages/ui';
import { canOpen, SECTIONS, type Section } from './sections';

const ITEM = 'block rounded px-3 py-1.5 text-sm';

function SidebarItem({ section }: { section: Section }) {
  const allowed = canOpen(useSession(), section);
  if (!allowed) return null;
  if (section.soon) {
    return (
      <li>
        <span aria-disabled="true" className={`${ITEM} cursor-not-allowed text-slate-400`}>
          {section.label} <span className="text-xs">Coming soon</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <NavLink
        to={`/admin/${section.path}`}
        className={({ isActive }) =>
          `${ITEM} hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 ${
            isActive ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700'
          }`
        }
      >
        {section.label}
      </NavLink>
    </li>
  );
}

/** What a section shows to a user who may not use it. The server refuses them as well. */
export function NoAccess() {
  return <p className="text-sm text-slate-700">Your role does not include this section.</p>;
}

/** The Control Panel's frame: a header, a sidebar of the sections the user may use, the page. */
export function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/" className="text-base font-semibold tracking-tight">
          EZDesign
        </Link>
        <span className="text-sm text-slate-600">Control Panel</span>
        <AccountLinks />
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav aria-label="Control Panel" className="w-48 shrink-0">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => (
              <SidebarItem key={section.path} section={section} />
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
