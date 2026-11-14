import { conflictEditor, isConflict } from '../api/client';
import { formatDate } from '../pages/format';
import { ErrorState } from '@/components/patterns/state-views';

/**
 * What a 409 on a draft says: someone else saved it first. Names who and when when the server
 * knows, and offers the reload that shows their version. Nothing is overwritten silently: the
 * user's edits are not saved until they have seen the other draft.
 */
export function ConflictNotice({ error }: { error: unknown }) {
  if (!isConflict(error)) return null;
  const editor = conflictEditor(error);
  return (
    <ErrorState
      title="Someone else changed the draft"
      description={`${
        editor
          ? `${editor.updated_by || 'Another editor'} saved it on ${formatDate(editor.updated_at)}. `
          : ''
      }Reload to see their changes; yours are not saved.`}
      retryLabel="Reload the latest draft"
      onRetry={() => window.location.reload()}
    />
  );
}
