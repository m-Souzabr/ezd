import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type DesignVersionSummary } from '../../api/client';
import { versionsKey } from '../../api/keys';
import { Field } from './fields';

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The saved versions of a design: save the current draft as a new one, look at an old
 * one, or restore it. `beforeSave` sends any unsaved change first, so the version is of
 * what is on screen.
 */
export function VersionsDialogBody({
  designId,
  open,
  onOpenChange: setOpen,
  beforeSave,
  onPreview,
  onRestore,
}: {
  designId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  beforeSave(): Promise<void>;
  onPreview(version: DesignVersionSummary): void;
  onRestore(version: DesignVersionSummary): Promise<void>;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  /** The version whose Restore was clicked, which a dialog asks to confirm. */
  const [confirming, setConfirming] = useState<DesignVersionSummary | null>(null);
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
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(label.trim());
  };
  const error = list.error ?? save.error ?? restore.error;

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setConfirming(null);
        }}
        title="Version history"
        description="A version is a copy of the design as it is now. It does not change afterwards."
        showCloseButton={false}
        footer={
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Label (optional)" htmlFor={`${id}-label`}>
                <Input
                  id={`${id}-label`}
                  value={label}
                  maxLength={200}
                  placeholder="Before moving the sink"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" disabled={save.isPending}>
              Save version
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}

          <div className="min-h-0">
            {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
            {list.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No versions saved yet.</p>
            )}
            <ul aria-label="Versions" className="divide-y">
              {list.data?.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">Version {version.number}</span>
                  {version.label && <span>{version.label}</span>}
                  <span className="mr-auto text-xs text-muted-foreground">
                    {DATE.format(new Date(version.created_at))}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Preview version ${version.number}`}
                    onClick={() => {
                      setOpen(false);
                      onPreview(version);
                    }}
                  >
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Restore version ${version.number}`}
                    disabled={restore.isPending}
                    onClick={() => setConfirming(version)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          title={`Restore version ${confirming?.number ?? ''}?`}
          description="The current draft is replaced by this version. Save a version first to keep the draft."
          confirmLabel="Replace the draft"
          onConfirm={() => confirming && restore.mutate(confirming)}
        />
      </ResponsiveDialog>
    </>
  );
}
