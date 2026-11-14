import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { ApiError, isConflict } from '../api/client';
import { api } from '../api/client';
import { configDraftKey, configVersionsKey } from '../api/keys';
import { BUTTON } from '../editor/panels/fields';
import { FormError, PRIMARY } from '../pages/ui';
import { PublishDialog, VersionHistory } from './AppSettings';
import { ConflictNotice } from './ConflictNotice';

export type LoadedSection<T> = { revision: number; value: T; basedOn: number | null };

/**
 * One section of the configuration (the rules, the quote defaults) as a draft: a bar with
 * Save draft and Publish, the form the caller draws, and the version history. A stale draft
 * is a conflict the user resolves by reloading; a refused section shows the server's reason.
 */
export function DraftSection<T>({
  loaded,
  save,
  problems,
  notice,
  onPublished,
  onReset,
  resetLabel,
  children,
}: {
  loaded: LoadedSection<T>;
  /** Stores the section as the draft, at the revision the editor holds. */
  save(revision: number, value: T): Promise<{ revision: number }>;
  /** How many things stop the draft from being saved. */
  problems(value: T): number;
  notice: string | null;
  onPublished(message: string): void;
  /** The value every default gives, for the page's Reset button. */
  onReset?: () => T;
  resetLabel?: string;
  children(state: { value: T; set(next: T | ((current: T) => T)): void }): ReactNode;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(loaded.value);
  const [saved, setSaved] = useState(loaded.value);
  const [revision, setRevision] = useState(loaded.revision);
  const [message, setMessage] = useState<string | null>(notice);
  const [publishing, setPublishing] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  const saveDraft = useMutation({
    mutationFn: () => save(revision, value),
    onSuccess: (draft) => {
      setRevision(draft.revision);
      setSaved(value);
      setMessage('Draft saved.');
    },
  });
  const publish = useMutation({
    mutationFn: async (note: string) => {
      // What is on screen is what gets published, so an unsaved edit is saved first.
      const draft = dirty || revision === 0 ? await save(revision, value) : null;
      return api.publishConfig(draft?.revision ?? revision, note);
    },
    onSuccess: async (version) => {
      setPublishing(false);
      // The refetched draft remounts this editor, so the page keeps the message.
      const published = `Published as version ${version.number}.`;
      setMessage(published);
      onPublished(published);
      setRevision(0);
      setSaved(value);
      await queryClient.invalidateQueries({ queryKey: configVersionsKey });
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
    },
  });

  const set = (next: T | ((current: T) => T)) => {
    setMessage(null);
    setValue(next);
  };
  const found = problems(value);
  const invalid = found > 0;
  const conflict = isConflict(saveDraft.error) || isConflict(publish.error);
  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
        <button
          type="button"
          className={BUTTON}
          disabled={!dirty || invalid || saveDraft.isPending}
          onClick={() => {
            setMessage(null);
            saveDraft.mutate();
          }}
        >
          Save draft
        </button>
        <button
          type="button"
          className={PRIMARY}
          disabled={invalid || (!dirty && revision === 0 && loaded.basedOn !== null)}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </button>
        {onReset && (
          <button type="button" className={BUTTON} onClick={() => set(onReset())}>
            {resetLabel ?? 'Reset to defaults'}
          </button>
        )}
        <span role="status" className="text-sm text-slate-600">
          {invalid
            ? `${found} ${found === 1 ? 'problem' : 'problems'} to fix first.`
            : (message ?? (dirty ? 'Unsaved changes.' : revision > 0 ? 'Draft saved.' : ''))}
        </span>
      </div>
      {!conflict && <FormError error={saveDraft.error} />}
      <ConflictNotice error={saveDraft.error ?? publish.error} />
      {children({ value, set })}
      <PublishDialog
        open={publishing}
        onClose={() => setPublishing(false)}
        unsaved={dirty}
        busy={publish.isPending}
        error={
          publish.error instanceof ApiError && publish.error.status === 409 ? null : publish.error
        }
        onPublish={(note) => publish.mutate(note)}
      />
      <VersionHistory />
    </div>
  );
}
