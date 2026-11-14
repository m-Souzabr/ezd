import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useId, useRef, useState } from 'react';

import {
  api,
  ApiError,
  conflictEditor,
  isConflict,
  issuesOf,
  type ResetSection,
} from '../api/client';
import { catalogDraftKey, configDraftKey } from '../api/keys';
import { useCan, userCan } from '../auth/can';
import { useSession } from '../auth/session';
import { FormError } from '../components/form-error';
import { errorMessage, formatDate } from '../pages/format';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { PageHeader } from '@/components/patterns/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NoAccess } from './AdminLayout';
import { ConflictNotice } from './ConflictNotice';
import { canOpen, SECTIONS } from './sections';

const RESETS: { section: ResetSection; label: string; permission: string; page: string }[] = [
  { section: 'catalog', label: 'Catalog', permission: 'config.catalog.edit', page: 'catalog' },
  { section: 'rules', label: 'Rules', permission: 'config.rules.edit', page: 'rules' },
  { section: 'app', label: 'App settings', permission: 'config.app.edit', page: 'app' },
  { section: 'quotes', label: 'Quote defaults', permission: 'config.quote.edit', page: 'quotes' },
];

/** The problems a rejected import lists, each with where in the file it is. */
function ImportProblems({ error }: { error: unknown }) {
  const issues = issuesOf(error);
  if (issues.length === 0) return <FormError error={error} />;
  return (
    <div role="alert" className="text-sm text-destructive">
      <p>The file was not imported, and nothing was changed:</p>
      <ul className="mt-1 list-disc pl-5">
        {issues.slice(0, 20).map((issue) => (
          <li key={`${issue.path}:${issue.message}`}>
            {issue.path ? <code>{issue.path}</code> : 'The file'}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImportCard() {
  const queryClient = useQueryClient();
  const fileId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<{ name: string; data: unknown } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (replace: boolean) => api.importConfig(text!.data, replace),
    onSuccess: async (result) => {
      setReplacing(false);
      setDone(
        `Saved ${result.sections.join(', ')} as ${result.sections.length === 1 ? 'a draft' : 'drafts'}. Review ${result.sections.length === 1 ? 'it' : 'them'} on the section pages, then publish.`,
      );
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
      await queryClient.invalidateQueries({ queryKey: catalogDraftKey });
    },
  });
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setText(null);
    setReadError(null);
    setDone(null);
    run.reset();
    if (!file) return;
    try {
      setText({ name: file.name, data: JSON.parse(await file.text()) });
    } catch {
      setReadError(`${file.name} is not a JSON file.`);
    }
  };
  const exists = isConflict(run.error) && run.error instanceof ApiError;
  return (
    <Card aria-label="Import" role="region">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Import</h2>
        <p className="text-sm text-muted-foreground">
          Read a file made by Export. It is checked first and saved as a draft; nothing is published
          until you publish it from the section page.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={fileId} className="text-sm font-medium">
              Configuration file
            </label>
            <input
              id={fileId}
              ref={input}
              type="file"
              accept="application/json,.json"
              className="text-sm"
              onChange={(event) => void choose(event)}
            />
          </div>
          <Button type="button" disabled={!text || run.isPending} onClick={() => run.mutate(false)}>
            Import as draft
          </Button>
        </div>
        {readError && (
          <p role="alert" className="text-sm text-destructive">
            {readError}
          </p>
        )}
        {exists ? (
          <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
            <p>
              {errorMessage(run.error)}
              {conflictEditor(run.error) && (
                <>
                  {' '}
                  Last saved by <strong>{conflictEditor(run.error)!.updated_by}</strong> on{' '}
                  {formatDate(conflictEditor(run.error)!.updated_at)}.
                </>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setReplacing(true)}
            >
              Replace the draft…
            </Button>
          </div>
        ) : (
          run.error && <ImportProblems error={run.error} />
        )}
        {done && (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
        <ConfirmDialog
          open={replacing}
          onOpenChange={setReplacing}
          title="Replace the draft?"
          description="The unpublished draft is overwritten by the file. The published version is not touched."
          confirmLabel="Replace the draft"
          onConfirm={() => run.mutate(true)}
        />
      </CardContent>
    </Card>
  );
}

function ResetCard() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: configDraftKey, queryFn: api.getConfigDraft });
  const catalog = useQuery({ queryKey: catalogDraftKey, queryFn: api.getCatalogDraft });
  const me = useSession();
  const [target, setTarget] = useState<(typeof RESETS)[number] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: (item: (typeof RESETS)[number]) =>
      api.resetSection(
        item.section,
        (item.section === 'catalog' ? catalog.data?.revision : config.data?.revision) ?? 0,
      ),
    onSuccess: async (_result, item) => {
      setTarget(null);
      setDone(`The ${item.label.toLowerCase()} draft now holds the defaults.`);
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
      await queryClient.invalidateQueries({ queryKey: catalogDraftKey });
    },
  });
  const allowed = RESETS.filter((item) => userCan(me, item.permission));
  return (
    <Card aria-label="Reset to defaults" role="region">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Reset to defaults</h2>
        <p className="text-sm text-muted-foreground">
          Replaces a section&apos;s draft with the values built into the app. The published version
          is not touched, and you can still discard the draft by not publishing it.
        </p>
        <ul className="flex flex-wrap gap-2">
          {allowed.map((item) => (
            <li key={item.section}>
              <Button
                type="button"
                variant="outline"
                disabled={config.isPending || catalog.isPending}
                onClick={() => {
                  setDone(null);
                  reset.reset();
                  setTarget(item);
                }}
              >
                Reset {item.label.toLowerCase()}…
              </Button>
            </li>
          ))}
        </ul>
        {done && (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
        <ConflictNotice error={target ? null : reset.error} />
        <ConfirmDialog
          open={target !== null}
          onOpenChange={(open) => !open && setTarget(null)}
          title={`Reset the ${target?.label.toLowerCase() ?? ''} draft to defaults?`}
          description="Whatever the draft of this section holds now is replaced."
          confirmLabel="Reset to defaults"
          onConfirm={() => target && reset.mutate(target)}
        />
        <FormError error={reset.error} />
      </CardContent>
    </Card>
  );
}

function Backup() {
  const canExport = useCan('config.catalog.edit');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Backup and reset"
        description="Export the published configuration, import one as a draft, or reset a section."
      />
      <Card aria-label="Export" role="region">
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Export</h2>
          <p className="text-sm text-muted-foreground">
            Downloads the published configuration as one JSON file: the app settings, rules, quote
            defaults{canExport ? ' and catalog' : ''} you may read. To export an older version, use
            Export in a section&apos;s version history.
          </p>
          <a
            className={buttonVariants({ variant: 'outline', className: 'self-start' })}
            href={api.configExportUrl()}
            download
          >
            Export the published configuration
          </a>
        </CardContent>
      </Card>
      <ImportCard />
      <ResetCard />
    </div>
  );
}

export function BackupPage() {
  const me = useSession();
  const section = SECTIONS.find((item) => item.path === 'backup')!;
  return canOpen(me, section) ? <Backup /> : <NoAccess />;
}
