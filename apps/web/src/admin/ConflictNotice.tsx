import { conflictEditor, isConflict } from '../api/client';
import { formatDate } from '../pages/format';
import { Button } from '@/components/ui/button';

/**
 * What a 409 on a draft says: someone else saved it first. Names who and when when the server
 * knows, and offers the reload that shows their version. Nothing is overwritten silently: the
 * user's edits are not saved until they have seen the other draft.
 */
export function ConflictNotice({ error }: { error: unknown }) {
  if (!isConflict(error)) return null;
  const editor = conflictEditor(error);
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
      <p>
        Someone else changed the draft.
        {editor && (
          <>
            {' '}
            <strong>{editor.updated_by || 'Another editor'}</strong> saved it on{' '}
            {formatDate(editor.updated_at)}.
          </>
        )}{' '}
        Reload to see their changes; yours are not saved.
      </p>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        Reload the latest draft
      </Button>
    </div>
  );
}
