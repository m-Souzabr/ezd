import { draftProblems, type RoomDraft, RoomDraftSchema } from '@ezd/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { api, ApiError, type PhotoDraft } from '../api/client';
import { photoDraftKey } from '../api/keys';
import { useCatalog } from '../catalog/useCatalog';
import { errorMessage } from '../pages/format';
import { FormError, LINK, Page, PRIMARY } from '../pages/ui';
import { BUTTON } from '../editor/panels/fields';
import { buildDocument } from './document';
import { DraftEditor } from './DraftEditor';
import { DraftPlan } from './DraftPlan';
import { PhotoViewer } from './PhotoViewer';

/** How long after the last correction it is saved. */
const DRAFT_SAVE_DELAY_MS = 800;
const DEFAULT_NAME = 'Kitchen from photo';

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
      <Page title={missing ? 'Draft not found' : 'The draft could not be opened'}>
        <p className="text-sm text-slate-600">
          {missing ? 'This draft does not exist or was deleted.' : errorMessage(draft.error)}{' '}
          <Link to="/projects" className={LINK}>
            Back to projects
          </Link>
        </p>
      </Page>
    );
  }
  if (!draft.data || !photo.data) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        <h1 className="sr-only">EZDesign</h1>
        <p role="status">Loading the draft…</p>
      </main>
    );
  }

  const projectId = photo.data.project;
  const { status } = draft.data;
  if (status === 'failed') return <AnalysisFailed draft={draft.data} projectId={projectId} />;
  if (status === 'confirmed' || status === 'discarded' || status === 'analyzing') {
    return (
      <Page title={status === 'confirmed' ? 'Draft confirmed' : 'Draft closed'}>
        <p className="text-sm text-slate-600">
          {status === 'confirmed' && draft.data.design ? (
            <>
              This draft became a design.{' '}
              <Link to={`/designs/${draft.data.design}`} className={LINK}>
                Open the design
              </Link>
            </>
          ) : status === 'analyzing' ? (
            'This photo is still being analyzed. Reload in a moment.'
          ) : (
            'This draft was discarded.'
          )}{' '}
          <Link to={`/projects/${projectId}`} className={LINK}>
            Back to the project
          </Link>
        </p>
      </Page>
    );
  }

  const parsed = RoomDraftSchema.safeParse(draft.data.draft);
  if (!parsed.success) {
    return (
      <Page title="The draft could not be read">
        <p className="text-sm text-slate-600">
          Analyze the photo again from the{' '}
          <Link to={`/projects/${projectId}`} className={LINK}>
            project page
          </Link>
          .
        </p>
      </Page>
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
    <Page title="The photo could not be analyzed">
      <p role="alert" className="mb-4 text-sm text-slate-700">
        {draft.error || 'The analysis did not give a usable draft.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={again.isPending}
          onClick={() => again.mutate()}
        >
          {again.isPending ? 'Analyzing…' : 'Try again'}
        </button>
        <Link to={`/projects/${projectId}`} className={BUTTON}>
          Try another photo
        </Link>
        <button
          type="button"
          className={BUTTON}
          disabled={template.isPending}
          onClick={() => template.mutate()}
        >
          Start from a template
        </button>
      </div>
      {again.isPending && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          Looking at the photo. This can take up to a minute.
        </p>
      )}
      <FormError error={again.error ?? template.error} />
    </Page>
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/" className="text-base font-semibold tracking-tight">
          EZDesign
        </Link>
        <h1 className="text-sm font-medium">Draft room from a photo</h1>
        <span role="status" className="text-xs text-slate-500">
          {save === 'saved'
            ? 'Saved'
            : save === 'saving'
              ? 'Saving…'
              : 'Not saved. Check your connection.'}
        </span>
        <Link to={`/projects/${projectId}`} className={`${LINK} ml-auto text-sm`}>
          Back to the project
        </Link>
      </header>
      <div
        role="note"
        className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"
      >
        <strong>Measurements come from you, not the photo.</strong> The photo only suggests the
        layout. Values marked <em>Estimated</em> are guesses: type each wall length, or tick it once
        you have checked it. Measure one wall first; the others are easier to judge from it.
      </div>
      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
        <div className="flex min-h-[24rem] flex-col gap-3 lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
          <PhotoViewer src={api.photoFileUrl(photoId)} alt="The kitchen photo" className="flex-1" />
          {notes && <p className="text-xs text-slate-600">Note from the analysis: {notes}</p>}
        </div>
        <div className="flex flex-col gap-3">
          <section aria-label="Plan preview" className="rounded-lg bg-white p-3 shadow-sm">
            <DraftPlan draft={draft} />
          </section>
          <DraftEditor draft={draft} catalog={catalog} onChange={change} />
          <section
            aria-label="Confirm"
            className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm"
          >
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Design name
              <input
                type="text"
                className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {problems.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-700">Before you confirm:</p>
                <ul aria-label="Still to do" className="list-disc pl-5 text-xs text-slate-700">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={problems.length > 0 || confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                {confirm.isPending ? 'Creating the design…' : 'Confirm and open the editor'}
              </button>
            </div>
            <FormError error={confirm.error} />
          </section>
        </div>
      </main>
    </div>
  );
}
