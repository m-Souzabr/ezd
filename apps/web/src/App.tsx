import { type ComponentType, lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { useConfig } from './config/useConfig';
import { RequireSession, SessionExpiry } from './auth/SessionGate';
import { RequireStaff } from './auth/RequireStaff';
import { LocalEditor } from './pages/LocalEditor';
import { AccountLinks } from './pages/ui';

// The Control Panel is for staff, and it brings its own forms and dialogs: it is loaded when visited.
const adminPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const AdminLayout = adminPage(() => import('./admin/AdminLayout'), 'AdminLayout');
const AdminHome = adminPage(() => import('./admin/AdminHome'), 'AdminHome');
const AppSettingsPage = adminPage(() => import('./admin/AppSettings'), 'AppSettingsPage');
const CatalogAdminPage = adminPage(() => import('./admin/CatalogAdmin'), 'CatalogAdminPage');
const QuotesAdminPage = adminPage(() => import('./admin/QuotesAdmin'), 'QuotesAdminPage');
const RulesAdminPage = adminPage(() => import('./admin/RulesAdmin'), 'RulesAdminPage');
const AISettingsPage = adminPage(() => import('./admin/AISettings'), 'AISettingsPage');
const AuditPage = adminPage(() => import('./admin/AuditPage'), 'AuditPage');
const UsersPage = adminPage(() => import('./admin/UsersPage'), 'UsersPage');

// The account pages are loaded when they are visited: the shell, the forms and the dialogs
// they bring stay out of the first load, which the editor at `/` has to keep small.
const AccountShell = lazy(() =>
  import('./pages/AccountShell').then((m) => ({ default: m.AccountShell })),
);
// The editor of a saved design brings the assistant, versions, quotes and the conflict dialog.
const DesignEditorPage = lazy(() =>
  import('./pages/DesignEditor').then((m) => ({ default: m.DesignEditorPage })),
);
const LoginPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('./pages/AuthPages').then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/AuthPages').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/AuthPages').then((m) => ({ default: m.ResetPasswordPage })),
);
const ProjectsPage = lazy(() =>
  import('./pages/Projects').then((m) => ({ default: m.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('./pages/Projects').then((m) => ({ default: m.ProjectDetailPage })),
);
const QuotePage = lazy(() => import('./pages/QuotePage').then((m) => ({ default: m.QuotePage })));
const PhotoDraftPage = lazy(() =>
  import('./photos/PhotoDraftPage').then((m) => ({ default: m.PhotoDraftPage })),
);

/**
 * The design-system gallery is for development and test builds, like `window.__ezd`. In a
 * production build the constant is false, so the import below is removed with its chunk.
 */
const GALLERY = import.meta.env.DEV || import.meta.env.MODE === 'test';
const DesignSystemPage = GALLERY
  ? lazy(() => import('./routes/design-system').then((m) => ({ default: m.DesignSystemPage })))
  : undefined;

/**
 * The routes. `/` is the editor on the design kept in this browser, which needs no
 * account. Projects and the designs in them belong to an account and need a session.
 */
export function App() {
  const { localEditor } = useConfig().features;
  return (
    <>
      <SessionExpiry />
      <Suspense
        fallback={
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Loading…
          </p>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              localEditor ? (
                <LocalEditor header={<AccountLinks />} />
              ) : (
                <Navigate to="/projects" replace />
              )
            }
          />
          {DesignSystemPage && (
            <Route
              path="/design-system"
              element={
                <Suspense fallback={null}>
                  <DesignSystemPage />
                </Suspense>
              }
            />
          )}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/designs/:id"
            element={
              <RequireSession>
                <DesignEditorPage />
              </RequireSession>
            }
          />
          <Route
            element={
              <RequireSession>
                <AccountShell />
              </RequireSession>
            }
          >
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/photo-drafts/:id" element={<PhotoDraftPage />} />
            <Route path="/quotes/:id" element={<QuotePage />} />
          </Route>
          <Route path="/settings/ai" element={<Navigate to="/admin/ai" replace />} />
          <Route
            path="/admin"
            element={
              <RequireSession>
                <RequireStaff>
                  <AdminLayout />
                </RequireStaff>
              </RequireSession>
            }
          >
            <Route index element={<AdminHome />} />
            <Route path="catalog" element={<CatalogAdminPage />} />
            <Route path="rules" element={<RulesAdminPage />} />
            <Route path="app" element={<AppSettingsPage />} />
            <Route path="quotes" element={<QuotesAdminPage />} />
            <Route path="ai" element={<AISettingsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
            {/* An unknown admin path stays in the Control Panel instead of falling through to `/`. */}
            <Route path="*" element={<AdminHome />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
