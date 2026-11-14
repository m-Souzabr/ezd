import { ErrorState } from '@/components/patterns/state-views';
import { Button } from '@/components/ui/button';

/** What the error boundary shows: the crash in words, and the ways to carry on. */
export function CrashPage({
  canDownload,
  onDownload,
}: {
  canDownload: boolean;
  onDownload: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <ErrorState
        title="Something went wrong"
        description={`EZDesign hit an error it could not recover from. Your saved work is safe: changes are saved as you go, and anything not yet sent is kept in this browser.${canDownload ? ' You can also download the design as it was a moment ago.' : ''}`}
        retryLabel="Reload"
        onRetry={() => window.location.reload()}
      >
        {canDownload && (
          <Button variant="outline" onClick={onDownload}>
            Download my design (JSON)
          </Button>
        )}
      </ErrorState>
    </main>
  );
}
