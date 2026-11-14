import type { DesignDocument } from '@ezd/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError } from '@/api/client';
import { FormError } from '@/components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataList, type DataListColumn } from '@/components/patterns/data-list';
import { PageHeader } from '@/components/patterns/page-header';
import { ResponsiveMenu } from '@/components/patterns/responsive-menu';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/state-views';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useConfig } from '@/config/useConfig';
import { clearLocalDesign, createLocalRepository } from '@/lib/repository';
import { PhotoSection } from '@/photos/PhotoSection';
import { errorMessage, formatDate } from './format';
import { NameDialog } from './NameDialog';

const PROJECTS = ['projects'] as const;
const project = (id: string) => ['projects', id] as const;
const designs = (projectId: string) => ['projects', projectId, 'designs'] as const;

const ROW_LINK = 'text-primary underline-offset-4 hover:underline';

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
    <Card aria-label="Design in this browser" role="region">
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          <strong>{local.name}</strong> is saved in this browser only. Import it to keep it in your
          account and open it on other machines.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={importIt.isPending}
            onClick={() => importIt.mutate(local)}
          >
            {importIt.isPending ? <Spinner aria-hidden="true" /> : null}
            Import into account
          </Button>
          <Link to="/" className={buttonVariants({ variant: 'link' })}>
            Open it here
          </Link>
        </div>
        <FormError error={importIt.error} />
      </CardContent>
    </Card>
  );
}

type Named = { id: string; name: string };

/** What the list of projects or designs needs: the rows, and the dialogs their actions open. */
function useNamedActions<T extends Named>(options: {
  what: string;
  rename: (row: T, name: string) => Promise<unknown>;
  remove: (row: T) => void;
}) {
  const [renaming, setRenaming] = useState<T | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const actions = (row: T) => (
    <ResponsiveMenu
      label={`Actions for ${options.what} ${row.name}`}
      actions={[
        {
          id: 'rename',
          label: 'Rename',
          icon: <PencilIcon aria-hidden="true" />,
          onSelect: () => setRenaming(row),
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2Icon aria-hidden="true" />,
          destructive: true,
          onSelect: () => setDeleting(row),
        },
      ]}
    />
  );
  const dialogs = (
    <>
      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={`Rename ${options.what}`}
        description={`Choose a new name for ${renaming?.name ?? 'it'}.`}
        label="New name"
        submitLabel="Save"
        initial={renaming?.name}
        onSubmit={(name) => (renaming ? options.rename(renaming, name) : Promise.resolve())}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${options.what}?`}
        description={`${deleting?.name ?? 'It'} will be removed from your account.`}
        confirmLabel={`Delete ${options.what}`}
        onConfirm={() => deleting && options.remove(deleting)}
      />
    </>
  );
  return { actions, dialogs };
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: PROJECTS, queryFn: api.listProjects });
  const refresh = () => queryClient.invalidateQueries({ queryKey: PROJECTS });
  const create = useMutation({ mutationFn: api.createProject, onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameProject(id, name),
    onSuccess: refresh,
  });
  const archive = useMutation({ mutationFn: api.archiveProject, onSuccess: refresh });
  type Row = NonNullable<typeof list.data>[number];

  const { actions, dialogs } = useNamedActions<Row>({
    what: 'project',
    rename: (row, name) => rename.mutateAsync({ id: row.id, name }),
    remove: (row) => archive.mutate(row.id),
  });
  const columns: DataListColumn<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      primary: true,
      cell: (row) => (
        <Link to={`/projects/${row.id}`} className={ROW_LINK}>
          {row.name}
        </Link>
      ),
    },
    { id: 'created', header: 'Created', cell: (row) => formatDate(row.created_at) },
  ];
  const newProject = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden="true" />
      New project
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Each project holds the designs, photos and quotes for one job."
        actions={newProject}
      />
      <ImportLocalDesign />
      <FormError error={rename.error ?? archive.error} />
      {list.isPending ? (
        <LoadingState label="Loading projects" />
      ) : list.error ? (
        <ErrorState
          title="The projects could not be loaded"
          description={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No projects"
          description="No projects yet. Create one to start a design."
          action={<Button onClick={() => setCreating(true)}>Create your first project</Button>}
        />
      ) : (
        <DataList
          caption="Projects"
          rows={list.data}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={actions}
        />
      )}
      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New project"
        description="Name the job. You can rename it later."
        label="Project name"
        submitLabel="Create project"
        onSubmit={(name) => create.mutateAsync(name)}
      />
      {dialogs}
    </div>
  );
}

export function ProjectDetailPage() {
  const photoImport = useConfig().features.photoImport;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
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
  type Row = NonNullable<typeof list.data>[number];

  const { actions, dialogs } = useNamedActions<Row>({
    what: 'design',
    rename: (row, name) => rename.mutateAsync({ id: row.id, name }),
    remove: (row) => remove.mutate(row.id),
  });
  const columns: DataListColumn<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      primary: true,
      cell: (row) => (
        <Link to={`/designs/${row.id}`} className={ROW_LINK}>
          {row.name}
        </Link>
      ),
    },
    { id: 'changed', header: 'Changed', cell: (row) => formatDate(row.updated_at) },
  ];

  const back = (
    <Link to="/projects" className={buttonVariants({ variant: 'link', className: 'px-0' })}>
      All projects
    </Link>
  );

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Project not found"
          description="This project does not exist or was deleted."
          actions={back}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={detail.data?.name ?? (detail.error ? errorMessage(detail.error) : 'Project')}
        description="The designs in this project."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" />
            New design
          </Button>
        }
      />
      <FormError error={rename.error ?? remove.error} />
      {list.isPending ? (
        <LoadingState label="Loading designs" />
      ) : list.error ? (
        <ErrorState
          title="The designs could not be loaded"
          description={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No designs"
          description="No designs in this project yet."
          action={<Button onClick={() => setCreating(true)}>Create your first design</Button>}
        />
      ) : (
        <DataList
          caption="Designs"
          rows={list.data}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={actions}
        />
      )}
      {detail.data && photoImport && <PhotoSection projectId={id} />}
      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New design"
        description="Name the design. It opens in the editor."
        label="Design name"
        submitLabel="Create design"
        onSubmit={(name) => create.mutateAsync(name)}
      />
      {dialogs}
    </div>
  );
}
