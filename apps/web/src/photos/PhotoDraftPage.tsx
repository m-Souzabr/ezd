import { draftProblems, type RoomDraft, RoomDraftSchema } from '@ezd/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError, type PhotoDraft } from '@/api/client';
import { photoDraftKey } from '@/api/keys';
import { useCatalog } from '@/catalog/useCatalog';
import { FormError } from '@/components/form-error';
import { FormActions } from '@/components/patterns/form-section';
import { PageHeader } from '@/components/patterns/page-header';
import { LoadingState } from '@/components/patterns/state-views';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/pages/format';
import { buildDocument } from './document';
import { DraftEditor } from './DraftEditor';
import { DraftPlan } from './DraftPlan';
import { PhotoViewer } from './PhotoViewer';

/** How long after the last correction it is saved. */
const DRAFT_SAVE_DELAY_MS = 800;
const DEFAULT_NAME = 'Kitchen from photo';
const TEXT_LINK = buttonVariants({ variant: 'link', className: 'h-auto p-0' });

/** A page that says one thing and links on: a missing, closed or unreadable draft. */
function DraftMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function PhotoDraftPage() {
  const { id = '' } = useParams();
  return <PhotoDraftScreen key={id} draftId={id} />;
}

function PhotoDraftScreen({ draftId }: { draftId: string }) {
  const draft = useQuery({
    queryKey: photoDraftKey(draftId),
    queryFn: () => api.getPhotoDraft(draftId),
    retry: false,
    // The corrections live on this page once loaded; a refetch would undo typing.
    staleTime: Infinity,
  });
  const photoId = draft.data?.photo;
  const photo = useQuery({
    queryKey: ['photos', photoId],
    queryFn: () => api.getPhoto(photoId!),
    enabled: photoId !== undefined,
    retry: false,
  });

  if (draft.error) {
    const missing = draft.error instanceof ApiError && draft.error.status === 404;
    return (
      <DraftMessage title={missing ? 'Draft not found' : 'The draft could not be opened'}>
        {missing ? 'This draft does not exist or was deleted.' : errorMessage(draft.error)}{' '}
        <Link to="/projects" className={TEXT_LINK}>
          Back to projects
        </Link>
      </DraftMessage>
    );
  }
  if (!draft.data || !photo.data) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Draft room from a photo</h1>
        <LoadingState label="Loading the draft…" />
      </div>
    );
  }

  const projectId = photo.data.project;
  const { status } = draft.data;
  if (status === 'failed') return <AnalysisFailed draft={draft.data} projectId={projectId} />;
  if (status === 'confirmed' || status === 'discarded' || status === 'analyzing') {
    return (
      <DraftMessage title={status === 'confirmed' ? 'Draft confirmed' : 'Draft closed'}>
        {status === 'confirmed' && draft.data.design ? (
          <>
            This draft became a design.{' '}
            <Link to={`/designs/${draft.data.design}`} className={TEXT_LINK}>
              Open the design
            </Link>
          </>
        ) : status === 'analyzing' ? (
          'This photo is still being analyzed. Reload in a moment.'
        ) : (
          'This draft was discarded.'
        )}{' '}
        <Link to={`/projects/${projectId}`} className={TEXT_LINK}>
          Back to the project
        </Link>
      </DraftMessage>
    );
  }

  const parsed = RoomDraftSchema.safeParse(draft.data.draft);
  if (!parsed.success) {
    return (
      <DraftMessage title="The draft could not be read">
        Analyze the photo again from the{' '}
        <Link to={`/projects/${projectId}`} className={TEXT_LINK}>
          project page
        </Link>
        .
      </DraftMessage>
    );
  }
  return (
    <Correction
      draftId={draftId}
      photoId={draft.data.photo}
      projectId={projectId}
      initial={parsed.data}
      notes={parsed.data.notes}
    />
  );
}

/** The analysis gave nothing usable: offer the ways forward. */
function AnalysisFailed({ draft, projectId }: { draft: PhotoDraft; projectId: string }) {
  const navigate = useNavigate();
  const again = useMutation({
    mutationFn: () => api.analyzePhoto(draft.photo),
    onSuccess: (next) => void navigate(`/photo-drafts/${next.id}`),
  });
  const template = useMutation({
    mutationFn: () => api.createDesign(projectId, { name: 'Kitchen' }),
    onSuccess: (design) => void navigate(`/designs/${design.id}`),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="The photo could not be analyzed" />
      <p role="alert" className="text-sm">
        {draft.error || 'The analysis did not give a usable draft.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={again.isPending} onClick={() => again.mutate()}>
          {again.isPending ? <Spinner aria-hidden="true" /> : null}
          {again.isPending ? 'Analyzing…' : 'Try again'}
        </Button>
        <Link to={`/projects/${projectId}`} className={buttonVariants({ variant: 'outline' })}>
          Try another photo
        </Link>
        <Button variant="outline" disabled={template.isPending} onClick={() => template.mutate()}>
          Start from a template
        </Button>
      </div>
      {again.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Looking at the photo. This can take up to a minute.
        </p>
      )}
      <FormError error={again.error ?? template.error} />
    </div>
  );
}

type SaveState = 'saved' | 'saving' | 'error';

function Correction({
  draftId,
  photoId,
  projectId,
  initial,
  notes,
}: {
  draftId: string;
  photoId: string;
  projectId: string;
  initial: RoomDraft;
  notes: string;
}) {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [draft, setDraft] = useState(initial);
  const [name, setName] = useState(DEFAULT_NAME);
  const [save, setSave] = useState<SaveState>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);
  /** The save in flight, so the next waits for it and Confirm waits for all of them. */
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const problems = draftProblems(draft);

  const send = () => {
    timer.current = null;
    const body = latest.current;
    inFlight.current = inFlight.current
      .then(() => api.updatePhotoDraft(draftId, body))
      .then(
        () => setSave(timer.current === null && latest.current === body ? 'saved' : 'saving'),
        () => setSave('error'),
      );
    return inFlight.current;
  };

  useEffect(
    () => () => {
      // Leaving the page sends what is not saved yet.
      if (timer.current !== null) {
        clearTimeout(timer.current);
        void api.updatePhotoDraft(draftId, latest.current).catch(() => {});
      }
    },
    [draftId],
  );

  const change = (next: RoomDraft) => {
    setDraft(next);
    latest.current = next;
    setSave('saving');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), DRAFT_SAVE_DELAY_MS);
  };

  const confirm = useMutation({
    mutationFn: async () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        await send();
      } else {
        await inFlight.current;
      }
      const built = buildDocument(latest.current, name.trim() || DEFAULT_NAME, catalog);
      if (!built.ok) throw new Error(built.error.join(' '));
      return api.confirmPhotoDraft(draftId, built.value, name.trim() || DEFAULT_NAME);
    },
    onSuccess: (design) => void navigate(`/designs/${design.id}`),
  });

  const nameId = useId();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Draft room from a photo"
        actions={
          <Link to={`/projects/${projectId}`} className={buttonVariants({ variant: 'outline' })}>
            Back to the project
          </Link>
        }
      />
      <p role="status" className="-mt-4 text-sm text-muted-foreground">
        {save === 'saved'
          ? 'Saved'
          : save === 'saving'
            ? 'Saving…'
            : 'Not saved. Check your connection.'}
      </p>
      <Card role="note">
        <CardContent className="text-sm">
          <strong>Measurements come from you, not the photo.</strong> The photo only suggests the
          layout. Values marked <em>Estimated</em> are guesses: type each wall length, or tick it
          once you have checked it. Measure one wall first; the others are easier to judge from it.
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-h-[24rem] flex-col gap-3 lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
          <PhotoViewer src={api.photoFileUrl(photoId)} alt="The kitchen photo" className="flex-1" />
          {notes && (
            <p className="text-xs text-muted-foreground">Note from the analysis: {notes}</p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <section aria-label="Plan preview">
            <Card>
              <CardContent>
                <DraftPlan draft={draft} />
              </CardContent>
            </Card>
          </section>
          <DraftEditor draft={draft} catalog={catalog} onChange={change} />
          <section aria-label="Confirm">
            <Card>
              <CardContent className="flex flex-col gap-4">
                <Field>
                  <FieldLabel htmlFor={nameId}>Design name</FieldLabel>
                  <Input
                    id={nameId}
                    type="text"
                    value={name}
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                {problems.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Before you confirm:</p>
                    <ul aria-label="Still to do" className="flex flex-col gap-2 text-sm">
                      {problems.map((problem) => (
                        <li key={problem} className="flex items-start gap-2">
                          <Badge variant="warning">To do</Badge>
                          <span>{problem}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <FormError error={confirm.error} />
                <FormActions aboveTabBar>
                  <Button
                    type="button"
                    className="flex-1 md:flex-none"
                    disabled={problems.length > 0 || confirm.isPending}
                    onClick={() => confirm.mutate()}
                  >
                    {confirm.isPending ? <Spinner aria-hidden="true" /> : null}
                    {confirm.isPending ? 'Creating the design…' : 'Confirm and open the editor'}
                  </Button>
                </FormActions>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
