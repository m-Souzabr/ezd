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
import { BUTTON, CheckboxField, SelectField } from '../editor/panels/fields';
import { CloseButton, Modal } from '../pages/Modal';
import { errorMessage, formatDate } from '../pages/format';
import { FormError, PRIMARY } from '../pages/ui';
import { NoAccess } from './AdminLayout';
import { EntryForm } from './catalog/EntryForm';
import { FinishesTab } from './catalog/FinishesTab';
import { changeEntry, diffCatalogs, newEntry, problemsOfEntry } from './catalog/helpers';
import { ConflictNotice } from './ConflictNotice';
import { FIELD } from './controls';
import { DryRunSummary } from './DryRunSummary';
import { VersionCompare } from './VersionCompare';

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
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish this catalog?"
      description="Everyone gets it the next time they open the app. A published version never changes, and quotes already made keep their prices."
      width="w-[40rem]"
    >
      <section aria-label="Changes since the published catalog">
        <h3 className="mb-1 text-sm font-semibold">Changes from {published?.version ?? '…'}</h3>
        {changes === null ? (
          <p className="text-sm text-slate-600">Loading the published catalog…</p>
        ) : changes.length === 0 ? (
          <p className="text-sm text-slate-600">No changes.</p>
        ) : (
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-slate-800">
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
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          Note (what changed and why)
        </label>
        <input
          id={id}
          className={FIELD}
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {problems.length > 0 ? (
        <ul
          role="alert"
          className="list-disc rounded border border-red-200 bg-red-50 py-2 pr-3 pl-7 text-sm text-red-800"
        >
          {problems.map((problem) => (
            <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
          ))}
        </ul>
      ) : (
        <FormError error={error instanceof ApiError && error.status === 409 ? null : error} />
      )}
      <div className="flex justify-end gap-2">
        <CloseButton label="Cancel" />
        <button
          type="button"
          className={PRIMARY}
          disabled={busy || note.trim() === ''}
          onClick={() => onPublish(note)}
        >
          Publish
        </button>
      </div>
    </Modal>
  );
}

function VersionHistory() {
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: catalogVersionsKey, queryFn: api.listCatalogVersions });
  const [target, setTarget] = useState<string | null>(null);
  const rollback = useMutation({
    mutationFn: (version: string) => api.rollbackCatalog(version),
    onSuccess: async () => {
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: catalogVersionsKey });
      await queryClient.invalidateQueries({ queryKey: catalogDraftKey });
    },
  });
  const rows = versions.data ?? [];
  return (
    <section aria-label="Version history" className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">Version history</h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.version} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="font-medium">{row.version}</span>
            {row.current && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
                Published
              </span>
            )}
            <span className="text-slate-600">{row.note || 'No note'}</span>
            <span className="text-xs text-slate-600">
              {row.created_by || 'built in'} · {formatDate(row.created_at)}
            </span>
            <a
              className="ml-auto text-xs text-primary underline underline-offset-2"
              href={api.configExportUrl(undefined, row.version)}
              download
              aria-label={`Export ${row.version}`}
            >
              Export
            </a>
            {!row.current && (
              <button
                type="button"
                className={`${BUTTON} px-2 py-0.5 text-xs`}
                aria-label={`Roll back to ${row.version}`}
                onClick={() => setTarget(row.version)}
              >
                Roll back
              </button>
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
      <Modal
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        title={`Roll back to ${target ?? ''}?`}
        description="This publishes a copy of that version as a new one, for everyone. Nothing is deleted, and quotes keep the version they were made with."
      >
        <FormError error={rollback.error} />
        <div className="flex justify-end gap-2">
          <CloseButton label="Cancel" />
          <button
            type="button"
            className={PRIMARY}
            disabled={rollback.isPending}
            onClick={() => target !== null && rollback.mutate(target)}
          >
            Roll back
          </button>
        </div>
      </Modal>
    </section>
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
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New cabinet"
      description="It starts as a copy of the first entry of its kind, so you only change what differs."
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={idField} className="text-xs font-medium text-slate-600">
          Id (for example base.corner.deep)
        </label>
        <input
          id={idField}
          className={FIELD}
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        {taken && <p className="text-xs text-red-700">That id is already used.</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameField} className="text-xs font-medium text-slate-600">
          Name
        </label>
        <input
          id={nameField}
          className={FIELD}
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
      <div className="flex justify-end gap-2">
        <CloseButton label="Cancel" />
        <button
          type="button"
          className={PRIMARY}
          disabled={!id.trim() || !name.trim() || taken}
          onClick={() => {
            onAdd(newEntry(catalog, kind, id.trim(), name.trim()));
            setId('');
            setName('');
          }}
        >
          Add cabinet
        </button>
      </div>
    </Modal>
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
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
        <p className="text-sm text-slate-700">
          Draft based on <strong>{loaded.basedOn ?? 'the built-in catalog'}</strong>
          {dirty ? ' · unsaved changes' : revision > 0 ? ` · saved (revision ${revision})` : ''}
        </p>
        <button
          type="button"
          className={`${BUTTON} ml-auto`}
          disabled={!dirty || save.isPending}
          onClick={() => {
            setMessage(null);
            save.mutate();
          }}
        >
          Save draft
        </button>
        <button
          type="button"
          className={PRIMARY}
          disabled={problems.length > 0 || (!dirty && revision === 0)}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </button>
        <span role="status" className="text-sm text-slate-600">
          {problems.length > 0
            ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} to fix first.`
            : (message ?? '')}
        </span>
      </div>
      {!conflict && <FormError error={save.error} />}
      <ConflictNotice error={save.error ?? publish.error} />

      <div role="tablist" aria-label="Catalog" className="flex gap-2">
        {(['entries', 'finishes'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`${BUTTON} ${tab === name ? 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800' : ''}`}
            onClick={() => setTab(name)}
          >
            {name === 'entries' ? `Cabinets (${active})` : `Finishes (${catalog.finishes.length})`}
          </button>
        ))}
      </div>

      {tab === 'finishes' ? (
        <FinishesTab catalog={catalog} problems={problems} onChange={edit} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <section aria-label="Cabinets" className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
              <label className="text-xs font-medium text-slate-600">
                Search cabinets
                <input
                  type="search"
                  className={`${FIELD} mt-1 block w-full`}
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
              <button type="button" className={BUTTON} onClick={() => setAdding(true)}>
                New cabinet
              </button>
            </div>
            <ul className="flex flex-col divide-y divide-slate-100 rounded-lg bg-white shadow-sm">
              {entries.map(({ entry, index }) => {
                const count = problemsOfEntry(problems, index).length;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={entry.id === selected}
                      className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50 ${entry.id === selected ? 'bg-sky-50' : ''}`}
                      onClick={() => setSelected(entry.id)}
                    >
                      <span className="font-medium">{entry.name}</span>
                      <span className="text-xs text-slate-600">
                        {entry.id}
                        {entry.retired ? ' · retired' : ''}
                        {count > 0 ? ` · ${count} ${count === 1 ? 'problem' : 'problems'}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
              {entries.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-600">Nothing matches.</li>
              )}
            </ul>
          </section>
          <section aria-label="Entry" className="rounded-lg bg-white p-4 shadow-sm">
            {current >= 0 ? (
              <EntryForm
                key={catalog.entries[current]!.id}
                entry={catalog.entries[current]!}
                problems={problemsOfEntry(problems, current)}
                onChange={(next) => edit(changeEntry(catalog, next.id, () => next))}
              />
            ) : (
              <p className="text-sm text-slate-600">Choose a cabinet to edit.</p>
            )}
          </section>
        </div>
      )}

      {problems.filter((p) => !p.path.startsWith('entries.') || p.path === 'entries').length >
        0 && (
        <ul
          aria-label="Catalog problems"
          className="list-disc rounded border border-red-200 bg-red-50 py-2 pr-3 pl-7 text-sm text-red-800"
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
      <h1 className="mb-4 text-xl font-semibold">Catalog</h1>
      {loaded ? (
        <Editor key={`${loaded.revision}-${loaded.basedOn}`} loaded={loaded} />
      ) : draft.error ? (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(draft.error)}
        </p>
      ) : (
        <p role="status" className="text-sm text-slate-600">
          Loading…
        </p>
      )}
    </RequirePermission>
  );
}
