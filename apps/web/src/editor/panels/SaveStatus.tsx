import { Dialog } from 'radix-ui';
import { useSyncExternalStore } from 'react';

import type { Autosave, SaveStatus as Status } from '../../lib/autosave';
import { BUTTON } from './fields';

const TEXT: Record<Status, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline (retrying)',
  conflict: 'Conflict',
  error: 'Not saved',
};

const TONE: Record<Status, string> = {
  saved: 'text-slate-600',
  saving: 'text-slate-600',
  offline: 'text-amber-800',
  conflict: 'text-red-800',
  error: 'text-red-800',
};

const useSaveStatus = (autosave: Autosave): Status =>
  useSyncExternalStore(autosave.subscribe, autosave.status);

/** Whether the server has what is on screen. Read out when it changes. */
export function SaveStatus({ autosave }: { autosave: Autosave }) {
  const status = useSaveStatus(autosave);
  return (
    <span className="flex items-center gap-2 text-sm">
      <span role="status" data-testid="save-status" className={TONE[status]}>
        {TEXT[status]}
      </span>
      {(status === 'offline' || status === 'error') && (
        <button type="button" className={BUTTON} onClick={() => void autosave.flush()}>
          Retry now
        </button>
      )}
    </span>
  );
}

/**
 * Shown when the server refuses a save because the design was changed elsewhere, such as
 * in another tab. Autosave stays stopped until the user picks one of the two documents.
 */
export function ConflictDialog({
  autosave,
  onReloadTheirs,
}: {
  autosave: Autosave;
  onReloadTheirs(): void;
}) {
  const status = useSaveStatus(autosave);
  return (
    <Dialog.Root open={status === 'conflict'}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-slate-900">
            This design was changed elsewhere
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-600">
            It was saved from another tab or device after you opened it here, so your changes were
            not saved. Choose which one to keep.
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={onReloadTheirs}>
              Reload theirs
            </button>
            <button type="button" className={BUTTON} onClick={() => void autosave.overwrite()}>
              Overwrite with mine
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
