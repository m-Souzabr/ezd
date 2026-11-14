import {
  CircleAlertIcon,
  CircleCheckIcon,
  Loader2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
  type LucideIcon,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Autosave, SaveStatus as Status } from '../../lib/autosave';

const TEXT: Record<Status, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline (retrying)',
  conflict: 'Conflict',
  error: 'Not saved',
};

const TONE: Record<Status, string> = {
  saved: 'text-muted-foreground',
  saving: 'text-muted-foreground',
  offline: 'text-foreground',
  conflict: 'text-destructive',
  error: 'text-destructive',
};

/** The icon says it too, so the state is not carried by color alone. */
const ICON: Record<Status, LucideIcon> = {
  saved: CircleCheckIcon,
  saving: Loader2Icon,
  offline: WifiOffIcon,
  conflict: TriangleAlertIcon,
  error: CircleAlertIcon,
};

const useSaveStatus = (autosave: Autosave): Status =>
  useSyncExternalStore(autosave.subscribe, autosave.status);

/** Whether the server has what is on screen. Read out when it changes. */
export function SaveStatus({ autosave }: { autosave: Autosave }) {
  const status = useSaveStatus(autosave);
  const Icon = ICON[status];
  return (
    <span className="flex items-center gap-2 text-sm">
      <span
        role="status"
        data-testid="save-status"
        className={`flex items-center gap-1 ${TONE[status]}`}
      >
        <Icon
          className={status === 'saving' ? 'size-4 animate-spin' : 'size-4'}
          aria-hidden="true"
        />
        {TEXT[status]}
      </span>
      {(status === 'offline' || status === 'error') && (
        <Button variant="outline" size="xs" onClick={() => void autosave.flush()}>
          Retry now
        </Button>
      )}
    </span>
  );
}

/**
 * Shown when the server refuses a save because the design was changed elsewhere, such as
 * in another tab. Autosave stays stopped until the user picks one of the two documents, so
 * the dialog has no way to be dismissed.
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
    <AlertDialog open={status === 'conflict'}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>This design was changed elsewhere</AlertDialogTitle>
          <AlertDialogDescription>
            It was saved from another tab or device after you opened it here, so your changes were
            not saved. Choose which one to keep.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onReloadTheirs}>
            Reload theirs
          </Button>
          <Button onClick={() => void autosave.overwrite()}>Overwrite with mine</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
