import { Component, type ErrorInfo, lazy, type ReactNode, Suspense } from 'react';

import { recoverableDocument } from './lib/recovery';
import { reportError } from './lib/reportError';
import { downloadDocument } from './lib/repository';

// Loaded only when something crashed, so the page that shows the error is not in the first load.
const CrashPage = lazy(() => import('./CrashPage').then((m) => ({ default: m.CrashPage })));

type State = { crashed: boolean };

/**
 * The last line of defence: a crash anywhere below shows this page instead of a blank
 * screen, and the design that was open can still be downloaded. Autosave has already sent
 * or kept (in this browser) everything up to the crash.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { where: 'react', componentStack: info.componentStack ?? null });
  }

  override render() {
    if (!this.state.crashed) return this.props.children;
    const doc = recoverableDocument();
    return (
      <Suspense fallback={null}>
        <CrashPage canDownload={doc !== null} onDownload={() => doc && downloadDocument(doc)} />
      </Suspense>
    );
  }
}
