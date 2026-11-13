import {
  type AppConfig,
  DEFAULT_APP_CONFIG,
  ITEM_KINDS,
  parseAppConfig,
  validateAppConfig,
} from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useMemo, useState } from 'react';

import { api, ApiError, isConflict } from '../api/client';
import { configDraftKey, configVersionsKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { BUTTON, CheckboxField, LengthField } from '../editor/panels/fields';
import { CloseButton, Modal } from '../pages/Modal';
import { errorMessage, formatDate } from '../pages/format';
import { FormError, PRIMARY } from '../pages/ui';
import { NoAccess } from './AdminLayout';
import { FIELD } from './controls';

type Path = readonly string[];
type Errors = ReadonlyMap<string, string>;
type Section = keyof AppConfig;

/** A copy of `config` with the value at `path` replaced. */
function setAt(config: AppConfig, path: Path, value: unknown): AppConfig {
  const next = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  let at = next;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path[path.length - 1]!] = value;
  return next as unknown as AppConfig;
}

function getAt(config: AppConfig, path: Path): unknown {
  return path.reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], config);
}

type Edit = (path: Path, value: unknown) => void;
type Ctx = { config: AppConfig; errors: Errors; edit: Edit };

const key = (path: Path) => path.join('.');

function Toggle({ ctx, path, label }: { ctx: Ctx; path: Path; label: string }) {
  return (
    <div>
      <CheckboxField
        label={label}
        checked={getAt(ctx.config, path) as boolean}
        onChange={(value) => ctx.edit(path, value)}
      />
      <Problem errors={ctx.errors} path={path} />
    </div>
  );
}

function Problem({ errors, path }: { errors: Errors; path: Path }) {
  const message = errors.get(key(path));
  return message ? (
    <p role="alert" className="mt-1 text-xs text-red-700">
      {message}
    </p>
  ) : null;
}

function TextInput({
  ctx,
  path,
  label,
  multiline = false,
}: {
  ctx: Ctx;
  path: Path;
  label: string;
  multiline?: boolean;
}) {
  const id = useId();
  const value = getAt(ctx.config, path) as string;
  const props = {
    id,
    className: `${FIELD} w-full`,
    value,
    onChange: (event: { target: { value: string } }) => ctx.edit(path, event.target.value),
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
      <Problem errors={ctx.errors} path={path} />
    </div>
  );
}

/** A `#rrggbb` text box with a picker beside it. The text is checked by core as typed. */
function ColorInput({ ctx, path, label }: { ctx: Ctx; path: Path; label: string }) {
  const id = useId();
  const value = getAt(ctx.config, path) as string;
  const picker = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000';
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-10 rounded border border-slate-300"
          value={picker}
          onChange={(event) =>
            ctx.edit(
              path,
              value.length === 9 ? event.target.value + value.slice(7) : event.target.value,
            )
          }
        />
        <input
          id={id}
          type="text"
          spellCheck={false}
          className={`${FIELD} w-32 font-mono`}
          value={value}
          onChange={(event) => ctx.edit(path, event.target.value)}
        />
      </div>
      <Problem errors={ctx.errors} path={path} />
    </div>
  );
}

function NumberInput({ ctx, path, label }: { ctx: Ctx; path: Path; label: string }) {
  const id = useId();
  // Kept as text while typing, so "0." and an empty box are not rewritten under the cursor.
  const [text, setText] = useState<string | null>(null);
  const value = getAt(ctx.config, path) as number;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={`${FIELD} w-28`}
        value={text ?? String(value)}
        onChange={(event) => {
          setText(event.target.value);
          ctx.edit(
            path,
            event.target.value.trim() === '' ? Number.NaN : Number(event.target.value),
          );
        }}
        onBlur={() => setText(null)}
      />
      <Problem errors={ctx.errors} path={path} />
    </div>
  );
}

function Group({
  title,
  section,
  ctx,
  onReset,
  children,
}: {
  title: string;
  section: Section;
  ctx: Ctx;
  onReset(section: Section): void;
  children: ReactNode;
}) {
  const sectionError = ctx.errors.get(section);
  return (
    <section aria-label={title} className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          className={`${BUTTON} ml-auto px-2 py-0.5 text-xs`}
          aria-label={`Reset ${title} to defaults`}
          onClick={() => onReset(section)}
        >
          Reset to defaults
        </button>
      </div>
      {sectionError && (
        <p role="alert" className="mb-2 text-xs text-red-700">
          {sectionError}
        </p>
      )}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
);

const FEATURES: [keyof AppConfig['features'], string][] = [
  ['assistant', 'Chat assistant (it also needs an API key in AI settings)'],
  ['photoImport', 'Photo import'],
  ['quotes', 'Quotes'],
  ['versions', 'Saved versions'],
  ['roomTemplates', 'Room templates'],
  ['jsonImportExport', 'JSON import and export'],
  ['localEditor', 'Editor without an account (/)'],
  ['registrationOpen', 'Registration open'],
];

const TOOLS: [keyof AppConfig['toolbar']['tools'], string][] = [
  ['select', 'Select'],
  ['wall', 'Wall'],
  ['opening', 'Opening'],
  ['pan', 'Pan'],
];

const BUTTONS: [keyof AppConfig['toolbar']['buttons'], string][] = [
  ['undoRedo', 'Undo and Redo (and their keys)'],
  ['views', 'Plan and elevation switcher'],
  ['fit', 'Fit'],
  ['countertops', 'Generate countertops'],
  ['help', 'Help'],
];

const COLOR_LABELS: Record<string, string> = {
  gridMinor: 'Minor grid',
  gridMajor: 'Major grid',
  floor: 'Floor',
  wall: 'Wall',
  opening: 'Opening',
  openingLine: 'Opening outline',
  countertopLine: 'Countertop outline',
  itemLine: 'Item outline',
  label: 'Label',
  dimension: 'Dimension',
  selection: 'Selection',
  guide: 'Snap guide',
  error: 'Error',
  warning: 'Warning',
};

function Form({
  config,
  errors,
  edit,
  reset,
}: {
  config: AppConfig;
  errors: Errors;
  edit: Edit;
  reset(section: Section): void;
}) {
  const ctx: Ctx = { config, errors, edit };
  const order = config.panels.catalog.order;
  const move = (index: number, by: number) => {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    edit(['panels', 'catalog', 'order'], next);
  };
  const steps = config.help.steps;

  return (
    <div className="flex flex-col gap-4">
      <Group title="Panels" section="panels" ctx={ctx} onReset={reset}>
        <Toggle ctx={ctx} path={['panels', 'properties', 'visible']} label="Properties window" />
        <Toggle
          ctx={ctx}
          path={['panels', 'properties', 'defaultCollapsed']}
          label="Properties window starts collapsed"
        />
        <Toggle ctx={ctx} path={['panels', 'validation', 'visible']} label="Validation panel" />
        <Toggle ctx={ctx} path={['panels', 'materials', 'visible']} label="Materials panel" />
        <Toggle ctx={ctx} path={['panels', 'catalog', 'visible']} label="Catalog panel" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Catalog groups</legend>
          <Problem errors={errors} path={['panels', 'catalog', 'order']} />
          {order.map((kind, index) => (
            <div key={kind} className="flex flex-wrap items-end gap-3">
              <TextInput
                ctx={ctx}
                path={['panels', 'catalog', 'groups', kind, 'title']}
                label={`Title of ${kind}`}
              />
              <Toggle
                ctx={ctx}
                path={['panels', 'catalog', 'groups', kind, 'visible']}
                label={`Show ${kind}`}
              />
              <button
                type="button"
                className={BUTTON}
                disabled={index === 0}
                aria-label={`Move ${kind} up`}
                onClick={() => move(index, -1)}
              >
                Up
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={index === order.length - 1}
                aria-label={`Move ${kind} down`}
                onClick={() => move(index, 1)}
              >
                Down
              </button>
            </div>
          ))}
        </fieldset>
      </Group>

      <Group title="Features" section="features" ctx={ctx} onReset={reset}>
        {FEATURES.map(([name, label]) => (
          <Toggle key={name} ctx={ctx} path={['features', name]} label={label} />
        ))}
      </Group>

      <Group title="Toolbar" section="toolbar" ctx={ctx} onReset={reset}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Tools</legend>
          {TOOLS.map(([name, label]) => (
            <Toggle key={name} ctx={ctx} path={['toolbar', 'tools', name]} label={label} />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Buttons</legend>
          {BUTTONS.map(([name, label]) => (
            <Toggle key={name} ctx={ctx} path={['toolbar', 'buttons', name]} label={label} />
          ))}
        </fieldset>
      </Group>

      <Group title="Viewport" section="viewport" ctx={ctx} onReset={reset}>
        <Grid>
          <NumberInput
            ctx={ctx}
            path={['viewport', 'defaultScale']}
            label="Default scale (pixels per inch)"
          />
          <NumberInput ctx={ctx} path={['viewport', 'minScale']} label="Smallest scale" />
          <NumberInput ctx={ctx} path={['viewport', 'maxScale']} label="Largest scale" />
          <div>
            <LengthField
              label="Grid step"
              value={config.viewport.gridStep}
              onCommit={(length) => {
                edit(['viewport', 'gridStep'], length);
                return null;
              }}
            />
            <Problem errors={errors} path={['viewport', 'gridStep']} />
          </div>
        </Grid>
      </Group>

      <Group title="Theme" section="theme" ctx={ctx} onReset={reset}>
        <h3 className="text-sm font-medium text-slate-700">Plan</h3>
        <Grid>
          {Object.keys(config.theme.plan).map((name) => (
            <ColorInput
              key={name}
              ctx={ctx}
              path={['theme', 'plan', name]}
              label={COLOR_LABELS[name] ?? name}
            />
          ))}
        </Grid>
        <h3 className="text-sm font-medium text-slate-700">Item fills</h3>
        <Grid>
          {ITEM_KINDS.map((kind) => (
            <ColorInput
              key={kind}
              ctx={ctx}
              path={['theme', 'itemFill', kind]}
              label={`Fill of ${kind}`}
            />
          ))}
        </Grid>
      </Group>

      <Group title="Help" section="help" ctx={ctx} onReset={reset}>
        <Problem errors={errors} path={['help', 'steps']} />
        {steps.map((_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded border border-slate-200 p-3">
            <TextInput
              ctx={ctx}
              path={['help', 'steps', String(index), 'title']}
              label={`Step ${index + 1} title`}
            />
            <TextInput
              ctx={ctx}
              path={['help', 'steps', String(index), 'text']}
              label={`Step ${index + 1} text`}
              multiline
            />
            <button
              type="button"
              className={`${BUTTON} self-start`}
              disabled={steps.length <= 1}
              onClick={() =>
                edit(
                  ['help', 'steps'],
                  steps.filter((_, i) => i !== index),
                )
              }
            >
              Remove step {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BUTTON} self-start`}
          disabled={steps.length >= 10}
          onClick={() =>
            edit(['help', 'steps'], [...steps, { title: 'New step', text: 'What to do.' }])
          }
        >
          Add a step
        </button>
      </Group>
    </div>
  );
}

/** Issues by path. An issue under an array or a list is shown at its own field. */
function errorMap(config: AppConfig): Errors {
  const checked = validateAppConfig(config);
  const map = new Map<string, string>();
  if (!checked.ok) {
    for (const issue of checked.error) {
      // `help.steps[0].title` is the field `help.steps.0.title`.
      const path = issue.path.replace(/\[(\d+)\]/g, '.$1');
      if (!map.has(path)) map.set(path, issue.message);
    }
  }
  return map;
}

export function PublishDialog({
  open,
  onClose,
  busy,
  error,
  onPublish,
}: {
  open: boolean;
  onClose(): void;
  busy: boolean;
  error: unknown;
  onPublish(note: string): void;
}) {
  const [note, setNote] = useState('');
  const id = useId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish these settings?"
      description="Everyone gets them the next time they open the app. A published version never changes, but you can roll back to it later."
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          Note (what changed and why)
        </label>
        <input
          id={id}
          className={FIELD}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <CloseButton label="Cancel" />
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => onPublish(note)}>
          Publish
        </button>
      </div>
    </Modal>
  );
}

export function VersionHistory() {
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: configVersionsKey, queryFn: api.listConfigVersions });
  const [target, setTarget] = useState<number | null>(null);
  const rollback = useMutation({
    mutationFn: (number: number) => api.rollbackConfig(number),
    onSuccess: async () => {
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: configVersionsKey });
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
    },
  });
  const rows = versions.data ?? [];
  return (
    <section aria-label="Version history" className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">Version history</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing has been published yet: the app uses its defaults.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.number} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">Version {row.number}</span>
              {row.status === 'published' && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
                  Published
                </span>
              )}
              <span className="text-slate-600">{row.note || 'No note'}</span>
              <span className="text-xs text-slate-500">
                {row.created_by} · {formatDate(row.created_at)}
              </span>
              {row.status !== 'published' && (
                <button
                  type="button"
                  className={`${BUTTON} ml-auto px-2 py-0.5 text-xs`}
                  aria-label={`Roll back to version ${row.number}`}
                  onClick={() => setTarget(row.number)}
                >
                  Roll back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        title={`Roll back to version ${target}?`}
        description="This publishes a copy of that version as a new one, for everyone. Nothing is deleted."
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

type Loaded = { revision: number; config: AppConfig; basedOn: number | null };

function Editor({
  loaded,
  notice,
  onPublished,
}: {
  loaded: Loaded;
  notice: string | null;
  onPublished: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(loaded.config);
  const [saved, setSaved] = useState(loaded.config);
  const [revision, setRevision] = useState(loaded.revision);
  const [message, setMessage] = useState<string | null>(notice);
  const [publishing, setPublishing] = useState(false);
  const errors = useMemo(() => errorMap(config), [config]);
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

  const adopt = (draft: { revision: number; app_config: unknown }, next: AppConfig) => {
    setRevision(draft.revision);
    setSaved(next);
  };

  const save = useMutation({
    mutationFn: () => api.saveConfigDraft(revision, config),
    onSuccess: (draft) => {
      adopt(draft, config);
      setMessage('Draft saved.');
    },
  });
  const publish = useMutation({
    mutationFn: async (note: string) => {
      // What is on screen is what gets published, so an unsaved edit is saved first.
      const draft = dirty || revision === 0 ? await api.saveConfigDraft(revision, config) : null;
      return api.publishConfig(draft?.revision ?? revision, note);
    },
    onSuccess: async (version) => {
      setPublishing(false);
      // The refetched draft remounts this editor, so the page keeps the message.
      const published = `Published as version ${version.number}.`;
      setMessage(published);
      onPublished(published);
      setRevision(0);
      setSaved(config);
      await queryClient.invalidateQueries({ queryKey: configVersionsKey });
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
    },
  });

  const edit: Edit = (path, value) => {
    setMessage(null);
    setConfig((current) => setAt(current, path, value));
  };
  const reset = (section: Section) => {
    setMessage(null);
    setConfig((current) => ({ ...current, [section]: DEFAULT_APP_CONFIG[section] }));
  };

  const invalid = errors.size > 0;
  const conflict = isConflict(save.error) || isConflict(publish.error);
  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
        <button
          type="button"
          className={BUTTON}
          disabled={!dirty || invalid || save.isPending}
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
          disabled={invalid || (!dirty && revision === 0 && loaded.basedOn !== null)}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </button>
        <span role="status" className="text-sm text-slate-600">
          {invalid
            ? `${errors.size} ${errors.size === 1 ? 'problem' : 'problems'} to fix first.`
            : (message ?? (dirty ? 'Unsaved changes.' : revision > 0 ? 'Draft saved.' : ''))}
        </span>
        {conflict && (
          <button type="button" className={BUTTON} onClick={() => window.location.reload()}>
            Reload the latest draft
          </button>
        )}
      </div>
      {!conflict && <FormError error={save.error} />}
      {conflict && (
        <p role="alert" className="text-sm text-red-700">
          Someone else changed the draft. Reload to see their changes; yours are not saved.
        </p>
      )}
      <Form config={config} errors={errors} edit={edit} reset={reset} />
      <PublishDialog
        open={publishing}
        onClose={() => setPublishing(false)}
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

/**
 * The app settings: what the editor shows and how it looks, edited as a draft and then
 * published. The form is checked by core as you type; the server checks it again.
 */
export function AppSettingsPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const draft = useQuery({ queryKey: configDraftKey, queryFn: api.getConfigDraft });
  const loaded = useMemo<Loaded | null>(() => {
    if (!draft.data) return null;
    const parsed = parseAppConfig(draft.data.app_config);
    return {
      revision: draft.data.revision,
      basedOn: draft.data.based_on,
      config: parsed.ok ? parsed.value.config : DEFAULT_APP_CONFIG,
    };
  }, [draft.data]);
  return (
    <RequirePermission permission="config.app.edit" fallback={<NoAccess />}>
      <h1 className="mb-4 text-xl font-semibold">App settings</h1>
      {loaded ? (
        <Editor
          key={`${loaded.revision}-${loaded.basedOn}`}
          loaded={loaded}
          notice={notice}
          onPublished={setNotice}
        />
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
