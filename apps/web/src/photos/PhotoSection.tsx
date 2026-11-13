import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { api, type Photo } from '../api/client';
import { photosKey } from '../api/keys';
import { BUTTON } from '../editor/panels/fields';
import { formatDate } from '../pages/format';
import { ConfirmButton, FormError, LINK } from '../pages/ui';
import { ACCEPTED_TYPES, photoFileProblem } from './upload';

function Uploader({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded(photo: Photo): void;
}) {
  const inputId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const send = useMutation({
    mutationFn: (file: File) => api.uploadPhoto(projectId, file, setProgress),
    onSuccess: (photo) => {
      setPreview(null);
      onUploaded(photo);
    },
    onSettled: () => setProgress(null),
  });

  const choose = (file: File | undefined) => {
    if (!file) return;
    const found = photoFileProblem(file);
    setProblem(found);
    if (found) return;
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    send.mutate(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    choose(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${
          over ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white'
        }`}
      >
        <p className="text-slate-700">
          Drop a photo of the kitchen here, or{' '}
          <label htmlFor={inputId} className={`${LINK} cursor-pointer`}>
            choose a file
          </label>
          .
        </p>
        <p className="text-xs text-slate-500">
          JPEG, PNG or WebP, up to 10 MB. Stand in a corner so the whole run of cabinets shows.
        </p>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="sr-only"
          disabled={send.isPending}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {preview && (
          <img src={preview} alt="The photo being uploaded" className="max-h-40 rounded" />
        )}
        {progress !== null && (
          <progress aria-label="Upload progress" className="w-48" max={1} value={progress} />
        )}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <FormError error={send.error} />
    </div>
  );
}

function PhotoRow({ photo, projectId }: { photo: Photo; projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: photosKey(projectId) });
  const analyze = useMutation({
    mutationFn: () => api.analyzePhoto(photo.id),
    onSuccess: (draft) => {
      void refresh();
      void navigate(`/photo-drafts/${draft.id}`);
    },
  });
  const remove = useMutation({ mutationFn: () => api.deletePhoto(photo.id), onSuccess: refresh });
  const draft = photo.latest_draft;
  const label = `photo from ${formatDate(photo.created_at)}`;

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
      <img
        src={api.photoFileUrl(photo.id)}
        alt={`Kitchen ${label}`}
        className="h-16 w-24 rounded object-cover"
        loading="lazy"
      />
      <div className="mr-auto flex flex-col text-xs text-slate-500">
        <span>Uploaded {formatDate(photo.created_at)}</span>
        {draft?.status === 'failed' && <span>The last analysis failed.</span>}
      </div>
      {draft?.status === 'ready' ? (
        <Link to={`/photo-drafts/${draft.id}`} className={BUTTON}>
          Correct the draft
        </Link>
      ) : draft?.status === 'confirmed' && draft.design ? (
        <Link to={`/designs/${draft.design}`} className={BUTTON}>
          Open the design
        </Link>
      ) : (
        <button
          type="button"
          className={BUTTON}
          disabled={analyze.isPending}
          onClick={() => analyze.mutate()}
        >
          {analyze.isPending ? 'Analyzing…' : 'Analyze'}
          <span className="sr-only"> {label}</span>
        </button>
      )}
      <ConfirmButton label="Delete" what={label} onConfirm={() => remove.mutate()} />
      {analyze.isPending && (
        <p role="status" className="basis-full text-xs text-slate-600">
          Looking at the photo. This can take up to a minute.
        </p>
      )}
      <FormError error={analyze.error ?? remove.error} />
    </li>
  );
}

/** The photos of a project: upload one, turn it into a draft room, or delete it. */
export function PhotoSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const photos = useQuery({
    queryKey: photosKey(projectId),
    queryFn: () => api.listPhotos(projectId),
  });
  return (
    <section aria-label="Photos" className="mt-8 flex flex-col gap-3">
      <h2 className="text-base font-semibold">Start from a photo</h2>
      <p className="text-sm text-slate-600">
        Upload a photo of an existing kitchen to get a draft of its layout. You check the draft and
        type the real measurements before it becomes a design.
      </p>
      <Uploader
        projectId={projectId}
        onUploaded={() => void queryClient.invalidateQueries({ queryKey: photosKey(projectId) })}
      />
      <FormError error={photos.error} />
      {photos.data && photos.data.length > 0 && (
        <ul aria-label="Photos" className="rounded-lg bg-white shadow-sm">
          {photos.data.map((photo) => (
            <PhotoRow key={photo.id} photo={photo} projectId={projectId} />
          ))}
        </ul>
      )}
    </section>
  );
}
