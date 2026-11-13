import { Navigate, Route, Routes } from 'react-router';

import { RequireSession, SessionExpiry } from './auth/SessionGate';
import { AISettingsPage } from './pages/AISettings';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { DesignEditorPage } from './pages/DesignEditor';
import { LocalEditor } from './pages/LocalEditor';
import { ProjectDetailPage, ProjectsPage } from './pages/Projects';
import { QuotePage } from './pages/QuotePage';
import { AccountLinks } from './pages/ui';

/**
 * The routes. `/` is the editor on the design kept in this browser, which needs no
 * account. Projects and the designs in them belong to an account and need a session.
 */
export function App() {
  return (
    <>
      <SessionExpiry />
      <Routes>
        <Route path="/" element={<LocalEditor header={<AccountLinks />} />} />
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
          path="/quotes/:id"
          element={
            <RequireSession>
              <QuotePage />
            </RequireSession>
          }
        />
        <Route
          path="/settings/ai"
          element={
            <RequireSession>
              <AISettingsPage />
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
