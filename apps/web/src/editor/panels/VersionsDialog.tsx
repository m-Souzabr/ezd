import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type FormEvent, type ReactNode, useId, useState } from 'react';

import { api, type DesignVersionSummary } from '../../api/client';
import { versionsKey } from '../../api/keys';
import { BUTTON } from './fields';

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The saved versions of a design: save the current draft as a new one, look at an old
 * one, or restore it. `beforeSave` sends any unsaved change first, so the version is of
 * what is on screen.
 */
export function VersionsDialog({
  designId,
  trigger,
  beforeSave,
  onPreview,
  onRestore,
}: {
  designId: string;
  trigger: ReactNode;
  beforeSave(): Promise<void>;
  onPreview(version: DesignVersionSummary): void;
  onRestore(version: DesignVersionSummary): Promise<void>;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  /** The version whose Restore was clicked once, and now asks to be confirmed. */
  const [confirming, setConfirming] = useState<number | null>(null);
  const list = useQuery({
    queryKey: versionsKey(designId),
    queryFn: () => api.listVersions(designId),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: async (text: string) => {
      await beforeSave();
      return api.createVersion(designId, text);
    },
    onSuccess: () => {
      setLabel('');
      return queryClient.invalidateQueries({ queryKey: versionsKey(designId) });
    },
  });
  const restore = useMutation({
    mutationFn: onRestore,
    onSuccess: () => setOpen(false),
    onSettled: () => setConfirming(null),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(label.trim());
  };
  const error = list.error ?? save.error ?? restore.error;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirming(null);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[32rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-slate-900">
            Version history
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-600">
            A version is a copy of the design as it is now. It does not change afterwards.
          </Dialog.Description>

          <form onSubmit={submit} className="mt-4 flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={`${id}-label`} className="text-xs font-medium text-slate-600">
                Label (optional)
              </label>
              <input
                id={`${id}-label`}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
                value={label}
                maxLength={200}
                placeholder="Before moving the sink"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <button type="submit" className={BUTTON} disabled={save.isPending}>
              Save version
            </button>
          </form>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error.message}
            </p>
          )}

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {list.isPending && <p className="text-sm text-slate-600">Loading…</p>}
            {list.data?.length === 0 && (
              <p className="text-sm text-slate-600">No versions saved yet.</p>
            )}
            <ul aria-label="Versions" className="divide-y divide-slate-200">
              {list.data?.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">Version {version.number}</span>
                  {version.label && <span className="text-slate-700">{version.label}</span>}
                  <span className="mr-auto text-xs text-slate-500">
                    {DATE.format(new Date(version.created_at))}
                  </span>
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={`Preview version ${version.number}`}
                    onClick={() => {
                      setOpen(false);
                      onPreview(version);
                    }}
                  >
                    Preview
                  </button>
                  {confirming === version.number ? (
                    <button
                      type="button"
                      className={`${BUTTON} border-red-300 text-red-800`}
                      disabled={restore.isPending}
                      aria-label={`Confirm restoring version ${version.number}`}
                      onClick={() => restore.mutate(version)}
                    >
                      Replace the draft
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={BUTTON}
                      aria-label={`Restore version ${version.number}`}
                      onClick={() => setConfirming(version.number)}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className={BUTTON}>
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
