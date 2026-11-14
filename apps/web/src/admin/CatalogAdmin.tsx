import {
  activeEntries,
  type Catalog,
  type CatalogEntry,
  type CatalogProblem,
  ITEM_KINDS,
  parseCatalog,
  validateCatalog,
} from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';

import { api, ApiError, isConflict } from '../api/client';
import { catalogDraftKey, catalogDryRunKey, catalogVersionsKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { CheckboxField, SelectField } from '../editor/panels/fields';
import { errorMessage, formatDate } from '../pages/format';
import { NoAccess } from './AdminLayout';
import { EntryForm } from './catalog/EntryForm';
import { FinishesTab } from './catalog/FinishesTab';
import { changeEntry, diffCatalogs, newEntry, problemsOfEntry } from './catalog/helpers';
import { ConflictNotice } from './ConflictNotice';
import { DraftStatus } from './DraftSection';
import { DryRunSummary } from './DryRunSummary';
import { VersionCompare } from './VersionCompare';
import { Button, buttonVariants } from '@/components/ui/button';
import { FormError } from '@/components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/patterns/page-header';

type Loaded = { revision: number; catalog: Catalog; basedOn: string | null };

/** The rules the server will apply when publishing, from a 422's `errors`. */
function serverProblems(error: unknown): CatalogProblem[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  const body = error.body as { errors?: { path: string; message: string }[] } | null;
  return body?.errors ?? [];
}

function PublishDialog({
  open,
  onClose,
  published,
  catalog,
  busy,
  error,
  onPublish,
  unsaved,
}: {
  open: boolean;
  onClose(): void;
  published: Catalog | undefined;
  catalog: Catalog;
  busy: boolean;
  error: unknown;
  onPublish(note: string): void;
  unsaved: boolean;
}) {
  const [note, setNote] = useState('');
  const id = useId();
  const changes = published ? diffCatalogs(published, catalog) : null;
  const problems = serverProblems(error);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish this catalog?"
      description="Everyone gets it the next time they open the app. A published version never changes, and quotes already made keep their prices."
      showCloseButton={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || note.trim() === ''}
            onClick={() => onPublish(note)}
          >
            Publish
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section aria-label="Changes since the published catalog">
          <h3 className="mb-1 text-sm font-semibold">Changes from {published?.version ?? '…'}</h3>
          {changes === null ? (
            <p className="text-sm text-muted-foreground">Loading the published catalog…</p>
          ) : changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes.</p>
          ) : (
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-foreground">
              {changes.map((change) => (
                <li key={`${change.kind}:${change.id}`}>
                  {change.kind === 'entry' ? 'Entry' : 'Finish'} {change.id}: {change.what}
                </li>
              ))}
            </ul>
          )}
        </section>
        <DryRunSummary queryKey={catalogDryRunKey} run={api.dryRunCatalog} unsaved={unsaved} />
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
            Note (what changed and why)
          </label>
          <Input
            id={id}

            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {problems.length > 0 ? (
          <ul
            role="alert"
            className="list-disc rounded border border-destructive/30 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive"
          >
            {problems.map((problem) => (
              <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        ) : (
          <FormError error={error instanceof ApiError && error.status === 409 ? null : error} />
        )}
      </div>
    </ResponsiveDialog>
  );
}

function VersionHistory() {
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: catalogVersionsKey, queryFn: api.listCatalogVersions });
  const [target, setTarget] = useState<string | null>(null);
  const rollback = useMutation({
    mutationFn: (version: string) => api.rollbackCatalog(version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogVersionsKey });
      await queryClient.invalidateQueries({ queryKey: catalogDraftKey });
    },
  });
  const rows = versions.data ?? [];
  return (
    <Card role="region" aria-label="Version history">
      <CardHeader>
        <CardTitle>Version history</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.version} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">{row.version}</span>
              {row.current && <Badge variant="success">Published</Badge>}
              <span className="text-muted-foreground">{row.note || 'No note'}</span>
              <span className="text-xs text-muted-foreground">
                {row.created_by || 'built in'} · {formatDate(row.created_at)}
              </span>
              <a
                className={buttonVariants({ variant: 'link', size: 'sm', className: 'ml-auto' })}
                href={api.configExportUrl(undefined, row.version)}
                download
                aria-label={`Export ${row.version}`}
              >
                Export
              </a>
              {!row.current && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={`Roll back to ${row.version}`}
                  onClick={() => setTarget(row.version)}
                >
                  Roll back
                </Button>
              )}
            </li>
          ))}
        </ul>
        <VersionCompare
          kind="catalog"
          numbers={rows.map((row) => row.number)}
          label={(number) => rows.find((row) => row.number === number)?.version ?? `${number}`}
          load={api.diffCatalogVersions}
        />
        <FormError error={rollback.error} />
      </CardContent>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        title={`Roll back to ${target ?? ''}?`}
        description="This publishes a copy of that version as a new one, for everyone. Nothing is deleted, and quotes keep the version they were made with."
        confirmLabel="Roll back"
        onConfirm={() => target !== null && rollback.mutate(target)}
      />
    </Card>
  );
}

function NewEntryDialog({
  open,
  onClose,
  catalog,
  onAdd,
}: {
  open: boolean;
  onClose(): void;
  catalog: Catalog;
  onAdd(entry: CatalogEntry): void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CatalogEntry['kind']>('base');
  const idField = useId();
  const nameField = useId();
  const taken = catalog.entries.some((entry) => entry.id === id.trim());
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New cabinet"
      description="It starts as a copy of the first entry of its kind, so you only change what differs."
      showCloseButton={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!id.trim() || !name.trim() || taken}
            onClick={() => {
              onAdd(newEntry(catalog, kind, id.trim(), name.trim()));
              setId('');
              setName('');
            }}
          >
            Add cabinet
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={idField} className="text-xs font-medium text-muted-foreground">
            Id (for example base.corner.deep)
          </label>
          <Input
            id={idField}

            value={id}
            onChange={(event) => setId(event.target.value)}
          />
          {taken && <p className="text-xs text-destructive">That id is already used.</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={nameField} className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <Input
            id={nameField}

            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <SelectField
          label="Kind"
          value={kind}
          options={ITEM_KINDS.map((value) => ({ value, label: value }))}
          onChange={(value) => setKind(value as CatalogEntry['kind'])}
        />
      </div>
    </ResponsiveDialog>
  );
}

function Editor({ loaded }: { loaded: Loaded }) {
  const queryClient = useQueryClient();
  const [catalog, setCatalog] = useState(loaded.catalog);
  const [saved, setSaved] = useState(loaded.catalog);
  const [revision, setRevision] = useState(loaded.revision);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'entries' | 'finishes'>('entries');
  const [selected, setSelected] = useState<string | null>(loaded.catalog.entries[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [showRetired, setShowRetired] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [adding, setAdding] = useState(false);

  const problems = useMemo(() => validateCatalog(catalog), [catalog]);
  const dirty = JSON.stringify(catalog) !== JSON.stringify(saved);
  const published = useQuery({ queryKey: ['catalog', 'published'], queryFn: api.getCatalog });
  const publishedCatalog = useMemo(() => {
    const parsed = parseCatalog(published.data?.catalog);
    return parsed.ok ? parsed.value : undefined;
  }, [published.data]);

  const edit = (next: Catalog) => {
    setMessage(null);
    setCatalog(next);
  };

  const save = useMutation({
    mutationFn: () => api.saveCatalogDraft(revision, catalog),
    onSuccess: (draft) => {
      setRevision(draft.revision);
      setSaved(catalog);
      setMessage('Draft saved.');
    },
  });
  const publish = useMutation({
    mutationFn: async (note: string) => {
      // What is on screen is what gets published, so an unsaved edit is saved first.
      const draft = dirty || revision === 0 ? await api.saveCatalogDraft(revision, catalog) : null;
      return api.publishCatalog(draft?.revision ?? revision, note);
    },
    onSuccess: async (version) => {
      setPublishing(false);
      setMessage(`Published as ${version.version}.`);
      setRevision(0);
      setSaved(catalog);
      await queryClient.invalidateQueries({ queryKey: catalogVersionsKey });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'published'] });
    },
  });

  const entries = catalog.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => showRetired || !entry.retired || entry.id === selected)
    .filter(({ entry }) => kind === 'all' || entry.kind === kind)
    .filter(({ entry }) =>
      `${entry.id} ${entry.name}`.toLowerCase().includes(search.trim().toLowerCase()),
    );
  const current = catalog.entries.findIndex((entry) => entry.id === selected);
  const conflict = isConflict(save.error) || isConflict(publish.error);
  const active = activeEntries(catalog).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-card-foreground">
        <DraftStatus dirty={dirty} revision={revision} basedOn={loaded.basedOn} />
        <p className="text-sm text-foreground">
          Draft based on <strong>{loaded.basedOn ?? 'the built-in catalog'}</strong>
          {dirty ? ' · unsaved changes' : revision > 0 ? ` · saved (revision ${revision})` : ''}
        </p>
        <Button
          variant="outline"
          type="button"
          className="ml-auto"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setMessage(null);
            save.mutate();
          }}
        >
          Save draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty}
          onClick={() => {
            setMessage(null);
            setCatalog(saved);
          }}
        >
          Discard changes
        </Button>
        <Button
          type="button"
          disabled={problems.length > 0 || (!dirty && revision === 0)}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {problems.length > 0
            ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} to fix first.`
            : (message ?? '')}
        </span>
      </div>
      {!conflict && <FormError error={save.error} />}
      <ConflictNotice error={save.error ?? publish.error} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'entries' | 'finishes')}>
        <TabsList aria-label="Catalog">
          <TabsTrigger value="entries">Cabinets ({active})</TabsTrigger>
          <TabsTrigger value="finishes">Finishes ({catalog.finishes.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'finishes' ? (
        <FinishesTab catalog={catalog} problems={problems} onChange={edit} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <section aria-label="Cabinets" className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground">
              <label className="text-xs font-medium text-muted-foreground">
                Search cabinets
                <Input
                  type="search"
                  className="mt-1 block w-full"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <SelectField
                label="Kind"
                value={kind}
                options={[
                  { value: 'all', label: 'All kinds' },
                  ...ITEM_KINDS.map((value) => ({ value, label: value })),
                ]}
                onChange={setKind}
              />
              <CheckboxField label="Show retired" checked={showRetired} onChange={setShowRetired} />
              <Button variant="outline" type="button" onClick={() => setAdding(true)}>
                New cabinet
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card text-card-foreground">
              {entries.map(({ entry, index }) => {
                const count = problemsOfEntry(problems, index).length;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={entry.id === selected}
                      className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted/50 ${entry.id === selected ? 'bg-accent' : ''}`}
                      onClick={() => setSelected(entry.id)}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {entry.name}
                        {entry.retired && <Badge variant="secondary">Retired</Badge>}
                      </span>
                      <span className="text-xs text-foreground/70">
                        {entry.id}
                        {count > 0 ? ` · ${count} ${count === 1 ? 'problem' : 'problems'}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
              {entries.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">Nothing matches.</li>
              )}
            </ul>
          </section>
          <section
            aria-label="Entry"
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            {current >= 0 ? (
              <EntryForm
                key={catalog.entries[current]!.id}
                entry={catalog.entries[current]!}
                problems={problemsOfEntry(problems, current)}
                onChange={(next) => edit(changeEntry(catalog, next.id, () => next))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Choose a cabinet to edit.</p>
            )}
          </section>
        </div>
      )}

      {problems.filter((p) => !p.path.startsWith('entries.') || p.path === 'entries').length >
        0 && (
        <ul
          aria-label="Catalog problems"
          className="list-disc rounded border border-destructive/30 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive"
        >
          {problems
            .filter((p) => !p.path.startsWith('entries.') || p.path === 'entries')
            .filter((p) => !p.path.startsWith('finishes.'))
            .map((problem) => (
              <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
            ))}
        </ul>
      )}

      <NewEntryDialog
        open={adding}
        onClose={() => setAdding(false)}
        catalog={catalog}
        onAdd={(entry) => {
          edit({ ...catalog, entries: [...catalog.entries, entry] });
          setSelected(entry.id);
          setShowRetired(true);
          setAdding(false);
        }}
      />
      <PublishDialog
        open={publishing}
        onClose={() => setPublishing(false)}
        published={publishedCatalog}
        catalog={catalog}
        busy={publish.isPending}
        error={publish.error}
        unsaved={dirty}
        onPublish={(note) => publish.mutate(note)}
      />
      <VersionHistory />
    </div>
  );
}

/**
 * The cabinet catalog: entries, prices and finishes, edited as a draft and then published.
 * The form is checked by core as you type; the server checks it again when you publish.
 */
export function CatalogAdminPage() {
  const draft = useQuery({ queryKey: catalogDraftKey, queryFn: api.getCatalogDraft });
  const loaded = useMemo<Loaded | null>(() => {
    if (!draft.data) return null;
    const parsed = parseCatalog(draft.data.catalog);
    // A draft may break a rule while it is being worked on, so it is read without them.
    return {
      revision: draft.data.revision,
      basedOn: draft.data.based_on,
      catalog: parsed.ok ? parsed.value : (draft.data.catalog as Catalog),
    };
  }, [draft.data]);
  return (
    <RequirePermission permission="config.catalog.edit" fallback={<NoAccess />}>
      <PageHeader
        title="Catalog"
        description="Cabinets, prices and finishes, edited as a draft and published."
      />
      {loaded ? (
        <Editor key={`${loaded.revision}-${loaded.basedOn}`} loaded={loaded} />
      ) : draft.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(draft.error)}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      )}
    </RequirePermission>
  );
}
