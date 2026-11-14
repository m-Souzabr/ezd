import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { type DragEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { api, type Photo } from '@/api/client';
import { photoDraftStatusLabel } from './status';
import { photosKey } from '@/api/keys';
import { FormError } from '@/components/form-error';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatDate } from '@/pages/format';
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
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm',
          over ? 'border-primary bg-accent' : 'border-border bg-card',
        )}
      >
        <UploadIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <p>
          Drop a photo of the kitchen here, or{' '}
          <label
            htmlFor={inputId}
            className="cursor-pointer text-primary underline underline-offset-4 has-focus-visible:ring-3"
          >
            choose a file
          </label>
          .
        </p>
        <p className="text-xs text-muted-foreground">
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
          <img src={preview} alt="The photo being uploaded" className="max-h-40 rounded-md" />
        )}
        {progress !== null && (
          <progress
            aria-label="Upload progress"
            className="h-2 w-48 accent-primary"
            max={1}
            value={progress}
          />
        )}
      </div>
      {problem && <FieldError>{problem}</FieldError>}
      <FormError error={send.error} />
    </div>
  );
}

function PhotoRow({ photo, projectId }: { photo: Photo; projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
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
    <li>
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <img
            src={api.photoFileUrl(photo.id)}
            alt={`Kitchen ${label}`}
            className="h-24 w-full rounded-md object-cover sm:h-16 sm:w-24"
            loading="lazy"
          />
          <div className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            <span>Uploaded {formatDate(photo.created_at)}</span>
            {draft && (
              <span>
                <Badge variant={draft.status === 'failed' ? 'destructive' : 'secondary'}>
                  {photoDraftStatusLabel(draft.status)}
                </Badge>
              </span>
            )}
            {draft?.status === 'failed' && <span>The last analysis failed.</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draft?.status === 'ready' ? (
              <Link
                to={`/photo-drafts/${draft.id}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Correct the draft
              </Link>
            ) : draft?.status === 'confirmed' && draft.design ? (
              <Link
                to={`/designs/${draft.design}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Open the design
              </Link>
            ) : (
              <Button
                variant="outline"
                disabled={analyze.isPending}
                onClick={() => analyze.mutate()}
              >
                {analyze.isPending ? <Spinner aria-hidden="true" /> : null}
                {analyze.isPending ? 'Analyzing…' : 'Analyze'}
                <span className="sr-only"> {label}</span>
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              Delete<span className="sr-only"> {label}</span>
            </Button>
          </div>
          {analyze.isPending && (
            <p role="status" className="basis-full text-xs text-muted-foreground">
              Looking at the photo. This can take up to a minute.
            </p>
          )}
          <FormError error={analyze.error ?? remove.error} />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this photo?"
        description={`The ${label} and its drafts will be removed.`}
        confirmLabel="Delete photo"
        onConfirm={() => remove.mutate()}
      />
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
    <section aria-label="Photos" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Start from a photo</h2>
      <p className="text-sm text-muted-foreground">
        Upload a photo of an existing kitchen to get a draft of its layout. You check the draft and
        type the real measurements before it becomes a design.
      </p>
      <Uploader
        projectId={projectId}
        onUploaded={() => void queryClient.invalidateQueries({ queryKey: photosKey(projectId) })}
      />
      <FormError error={photos.error} />
      {photos.data && photos.data.length > 0 && (
        <ul aria-label="Photos" className="flex flex-col gap-3">
          {photos.data.map((photo) => (
            <PhotoRow key={photo.id} photo={photo} projectId={projectId} />
          ))}
        </ul>
      )}
    </section>
  );
}
