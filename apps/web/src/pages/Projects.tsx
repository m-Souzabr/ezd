import type { DesignDocument } from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError } from '../api/client';
import { BUTTON } from '../editor/panels/fields';
import { clearLocalDesign, createLocalRepository } from '../lib/repository';
import { errorMessage, formatDate } from './format';
import { FormError, InlineCreate, LINK, Page, RenameButton } from './ui';

const PROJECTS = ['projects'] as const;
const project = (id: string) => ['projects', id] as const;
const designs = (projectId: string) => ['projects', projectId, 'designs'] as const;

const ROW = 'flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0';
const LIST = 'rounded-lg bg-white shadow-sm';

/**
 * Offers to move the design made without an account, which is kept in this browser, into
 * the account: as a new project with that one design. The browser's copy is then removed.
 */
function ImportLocalDesign() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<DesignDocument | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createLocalRepository()
      .load()
      .then(({ doc }) => {
        if (!cancelled) setLocal(doc);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importIt = useMutation({
    mutationFn: async (doc: DesignDocument) => {
      const created = await api.createProject(doc.name);
      return api.createDesign(created.id, { name: doc.name, document: doc });
    },
    onSuccess: (design) => {
      clearLocalDesign();
      void queryClient.invalidateQueries({ queryKey: PROJECTS });
      void navigate(`/designs/${design.id}`);
    },
  });

  if (!local) return null;
  return (
    <section
      aria-label="Design in this browser"
      className="mb-6 flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm"
    >
      <p>
        <strong>{local.name}</strong> is saved in this browser only. Import it to keep it in your
        account and open it on other machines.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BUTTON}
          disabled={importIt.isPending}
          onClick={() => importIt.mutate(local)}
        >
          Import into account
        </button>
        <Link to="/" className={LINK}>
          Open it here
        </Link>
      </div>
      <FormError error={importIt.error} />
    </section>
  );
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: PROJECTS, queryFn: api.listProjects });
  const refresh = () => queryClient.invalidateQueries({ queryKey: PROJECTS });
  const create = useMutation({ mutationFn: api.createProject, onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameProject(id, name),
    onSuccess: refresh,
  });
  const archive = useMutation({ mutationFn: api.archiveProject, onSuccess: refresh });

  return (
    <Page title="Projects">
      <ImportLocalDesign />
      <div className="mb-6">
        <InlineCreate
          label="New project"
          button="Create project"
          placeholder="Lake house"
          pending={create.isPending}
          error={create.error}
          onSubmit={(name) => create.mutateAsync(name)}
        />
      </div>
      <FormError error={list.error ?? rename.error ?? archive.error} />
      {list.data?.length === 0 && (
        <p className="text-sm text-slate-600">No projects yet. Create one to start a design.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul aria-label="Projects" className={LIST}>
          {list.data.map((item) => (
            <li key={item.id} className={ROW}>
              <Link to={`/projects/${item.id}`} className={`${LINK} font-medium`}>
                {item.name}
              </Link>
              <span className="mr-auto text-xs text-slate-500">
                created {formatDate(item.created_at)}
              </span>
              <RenameButton
                name={item.name}
                what={`project ${item.name}`}
                onRename={(name) => rename.mutate({ id: item.id, name })}
              />
              <ConfirmButton
                label="Delete"
                what={`project ${item.name}`}
                onConfirm={() => archive.mutate(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** A button that asks once more before it does something that cannot be undone here. */
function ConfirmButton({
  label,
  what,
  onConfirm,
}: {
  label: string;
  what: string;
  onConfirm(): void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={BUTTON} onClick={() => setAsking(true)}>
        {label}
        <span className="sr-only"> {what}</span>
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1 text-sm">
      <button
        type="button"
        className={`${BUTTON} border-red-300 text-red-800`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Confirm {label.toLowerCase()}
        <span className="sr-only"> {what}</span>
      </button>
      <button type="button" className={BUTTON} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: project(id),
    queryFn: () => api.getProject(id),
    retry: false,
  });
  const list = useQuery({
    queryKey: designs(id),
    queryFn: () => api.listDesigns(id),
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: designs(id) });
  const create = useMutation({
    mutationFn: (name: string) => api.createDesign(id, { name }),
    onSuccess: (design) => void navigate(`/designs/${design.id}`),
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.renameDesign(input.id, input.name),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: api.deleteDesign, onSuccess: refresh });

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <Page title="Project not found">
        <p className="text-sm text-slate-600">
          This project does not exist or was deleted.{' '}
          <Link to="/projects" className={LINK}>
            Back to projects
          </Link>
        </p>
      </Page>
    );
  }

  return (
    <Page title={detail.data?.name ?? (detail.error ? errorMessage(detail.error) : 'Project')}>
      <p className="-mt-2 mb-6 text-sm">
        <Link to="/projects" className={LINK}>
          All projects
        </Link>
      </p>
      <div className="mb-6">
        <InlineCreate
          label="New design"
          button="Create design"
          placeholder="Kitchen"
          pending={create.isPending}
          error={create.error}
          onSubmit={(name) => create.mutateAsync(name)}
        />
      </div>
      <FormError error={list.error ?? rename.error ?? remove.error} />
      {list.data?.length === 0 && (
        <p className="text-sm text-slate-600">No designs in this project yet.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul aria-label="Designs" className={LIST}>
          {list.data.map((item) => (
            <li key={item.id} className={ROW}>
              <Link to={`/designs/${item.id}`} className={`${LINK} font-medium`}>
                {item.name}
              </Link>
              <span className="mr-auto text-xs text-slate-500">
                changed {formatDate(item.updated_at)}
              </span>
              <RenameButton
                name={item.name}
                what={`design ${item.name}`}
                onRename={(name) => rename.mutate({ id: item.id, name })}
              />
              <ConfirmButton
                label="Delete"
                what={`design ${item.name}`}
                onConfirm={() => remove.mutate(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
