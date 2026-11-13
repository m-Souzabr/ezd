import { Component, type ErrorInfo, type ReactNode } from 'react';

import { recoverableDocument } from './lib/recovery';
import { reportError } from './lib/reportError';
import { downloadDocument } from './lib/repository';

const BUTTON =
  'inline-flex items-center justify-center rounded border border-slate-300 bg-white px-3 py-1.5 ' +
  'text-sm text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-sky-500';

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
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-slate-900">
        <div role="alert" className="flex max-w-md flex-col gap-3 rounded-lg bg-white p-6 shadow">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-700">
            EZDesign hit an error it could not recover from. Your saved work is safe: changes are
            saved as you go, and anything not yet sent is kept in this browser.
            {doc && ' You can also download the design as it was a moment ago.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={() => window.location.reload()}>
              Reload
            </button>
            {doc && (
              <button type="button" className={BUTTON} onClick={() => downloadDocument(doc)}>
                Download my design (JSON)
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }
}
