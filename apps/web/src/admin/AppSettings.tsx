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
import { configDraftKey, configDryRunKey, configVersionsKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { CheckboxField, LengthField } from '../editor/panels/fields';
import { errorMessage, formatDate } from '../pages/format';
import { NoAccess } from './AdminLayout';
import { ConflictNotice } from './ConflictNotice';
import { DraftStatus } from './DraftSection';
import { DryRunSummary } from './DryRunSummary';
import { VersionCompare } from './VersionCompare';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/form-error';
import { PageHeader } from '@/components/patterns/page-header';

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
    <p role="alert" className="mt-1 text-xs text-destructive">
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
    value,
    onChange: (event: { target: { value: string } }) => ctx.edit(path, event.target.value),
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {multiline ? <Textarea rows={3} {...props} /> : <Input type="text" {...props} />}
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
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-10 rounded border border-input pointer-coarse:h-11 pointer-coarse:w-11"
          value={picker}
          onChange={(event) =>
            ctx.edit(
              path,
              value.length === 9 ? event.target.value + value.slice(7) : event.target.value,
            )
          }
        />
        <Input
          id={id}
          type="text"
          spellCheck={false}
          className="w-32 font-mono"
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
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        className="w-28"
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
    <section aria-label={title} className="rounded-lg border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex items-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="ml-auto "
          aria-label={`Reset ${title} to defaults`}
          onClick={() => onReset(section)}
        >
          Reset to defaults
        </Button>
      </div>
      {sectionError && (
        <p role="alert" className="mb-2 text-xs text-destructive">
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
          <legend className="mb-1 text-sm font-medium text-foreground">Catalog groups</legend>
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
              <Button
                variant="outline"
                type="button"

                disabled={index === 0}
                aria-label={`Move ${kind} up`}
                onClick={() => move(index, -1)}
              >
                Up
              </Button>
              <Button
                variant="outline"
                type="button"

                disabled={index === order.length - 1}
                aria-label={`Move ${kind} down`}
                onClick={() => move(index, 1)}
              >
                Down
              </Button>
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
          <legend className="mb-1 text-sm font-medium text-foreground">Tools</legend>
          {TOOLS.map(([name, label]) => (
            <Toggle key={name} ctx={ctx} path={['toolbar', 'tools', name]} label={label} />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">Buttons</legend>
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
        <h3 className="text-sm font-medium text-foreground">Plan</h3>
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
        <h3 className="text-sm font-medium text-foreground">Item fills</h3>
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
          <div key={index} className="flex flex-col gap-2 rounded border border-border p-3">
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
            <Button
              variant="outline"
              type="button"
              className="self-start"
              disabled={steps.length <= 1}
              onClick={() =>
                edit(
                  ['help', 'steps'],
                  steps.filter((_, i) => i !== index),
                )
              }
            >
              Remove step {index + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          type="button"
          className="self-start"
          disabled={steps.length >= 10}
          onClick={() =>
            edit(['help', 'steps'], [...steps, { title: 'New step', text: 'What to do.' }])
          }
        >
          Add a step
        </Button>
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
  unsaved = false,
}: {
  open: boolean;
  onClose(): void;
  busy: boolean;
  error: unknown;
  onPublish(note: string): void;
  /** The form has edits that are not saved yet, which the dry run cannot count. */
  unsaved?: boolean;
}) {
  const [note, setNote] = useState('');
  const id = useId();
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish these settings?"
      description="Everyone gets them the next time they open the app. A published version never changes, but you can roll back to it later."
      showCloseButton={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => onPublish(note)}>
            Publish
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DryRunSummary queryKey={configDryRunKey} run={api.dryRunConfig} unsaved={unsaved} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Note (what changed and why)
          </label>
          <Input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <FormError error={error} />
      </div>
    </ResponsiveDialog>
  );
}

export function VersionHistory() {
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: configVersionsKey, queryFn: api.listConfigVersions });
  const [target, setTarget] = useState<number | null>(null);
  const rollback = useMutation({
    mutationFn: (number: number) => api.rollbackConfig(number),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: configVersionsKey });
      await queryClient.invalidateQueries({ queryKey: configDraftKey });
    },
  });
  const rows = versions.data ?? [];
  return (
    <Card role="region" aria-label="Version history">
      <CardHeader>
        <CardTitle>Version history</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been published yet: the app uses its defaults.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.number} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium">Version {row.number}</span>
                {row.status === 'published' && <Badge variant="success">Published</Badge>}
                <span className="text-muted-foreground">{row.note || 'No note'}</span>
                <span className="text-xs text-muted-foreground">
                  {row.created_by} · {formatDate(row.created_at)}
                </span>
                <a
                  className={buttonVariants({ variant: 'link', size: 'sm', className: 'ml-auto' })}
                  href={api.configExportUrl(row.number)}
                  download
                  aria-label={`Export version ${row.number}`}
                >
                  Export
                </a>
                {row.status !== 'published' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Roll back to version ${row.number}`}
                    onClick={() => setTarget(row.number)}
                  >
                    Roll back
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <VersionCompare
          kind="config"
          numbers={rows.map((row) => row.number)}
          label={(number) => `Version ${number}`}
          load={api.diffConfigVersions}
        />
        <FormError error={rollback.error} />
      </CardContent>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        title={`Roll back to version ${target}?`}
        description="This publishes a copy of that version as a new one, for everyone. Nothing is deleted."
        confirmLabel="Roll back"
        onConfirm={() => target !== null && rollback.mutate(target)}
      />
    </Card>
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
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-card-foreground">
        <DraftStatus dirty={dirty} revision={revision} basedOn={loaded.basedOn} />
        <Button
          variant="outline"
          type="button"

          disabled={!dirty || invalid || save.isPending}
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
            setConfig(saved);
          }}
        >
          Discard changes
        </Button>
        <Button
          type="button"
          disabled={invalid || (!dirty && revision === 0 && loaded.basedOn !== null)}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {invalid
            ? `${errors.size} ${errors.size === 1 ? 'problem' : 'problems'} to fix first.`
            : (message ?? (dirty ? 'Unsaved changes.' : revision > 0 ? 'Draft saved.' : ''))}
        </span>
      </div>
      {!conflict && <FormError error={save.error} />}
      <ConflictNotice error={save.error ?? publish.error} />
      <Form config={config} errors={errors} edit={edit} reset={reset} />
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
      <PageHeader
        title="App settings"
        description="What the editor shows and how it looks, edited as a draft and published."
      />
      {loaded ? (
        <Editor
          key={`${loaded.revision}-${loaded.basedOn}`}
          loaded={loaded}
          notice={notice}
          onPublished={setNotice}
        />
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
