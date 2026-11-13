import { Navigate, Route, Routes } from 'react-router';

import { useConfig } from './config/useConfig';
import { RequireSession, SessionExpiry } from './auth/SessionGate';
import { AdminHome } from './admin/AdminHome';
import { AppSettingsPage } from './admin/AppSettings';
import { AdminLayout } from './admin/AdminLayout';
import { AISettingsPage } from './admin/AISettings';
import { AuditPage } from './admin/AuditPage';
import { UsersPage } from './admin/UsersPage';
import { RequireStaff } from './auth/RequireStaff';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { DesignEditorPage } from './pages/DesignEditor';
import { LocalEditor } from './pages/LocalEditor';
import { PhotoDraftPage } from './photos/PhotoDraftPage';
import { ProjectDetailPage, ProjectsPage } from './pages/Projects';
import { QuotePage } from './pages/QuotePage';
import { AccountLinks } from './pages/ui';

/**
 * The routes. `/` is the editor on the design kept in this browser, which needs no
 * account. Projects and the designs in them belong to an account and need a session.
 */
export function App() {
  const { localEditor } = useConfig().features;
  return (
    <>
      <SessionExpiry />
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
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/projects"
          element={
            <RequireSession>
              <ProjectsPage />
            </RequireSession>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireSession>
              <ProjectDetailPage />
            </RequireSession>
          }
        />
        <Route
          path="/designs/:id"
          element={
            <RequireSession>
              <DesignEditorPage />
            </RequireSession>
          }
        />
        <Route
          path="/photo-drafts/:id"
          element={
            <RequireSession>
              <PhotoDraftPage />
            </RequireSession>
          }
        />
        <Route
          path="/quotes/:id"
          element={
            <RequireSession>
              <QuotePage />
            </RequireSession>
          }
        />
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
          <Route path="app" element={<AppSettingsPage />} />
          <Route path="ai" element={<AISettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit" element={<AuditPage />} />
          {/* An unknown admin path stays in the Control Panel instead of falling through to `/`. */}
          <Route path="*" element={<AdminHome />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
