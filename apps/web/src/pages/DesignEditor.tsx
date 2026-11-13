import type { DesignDocument } from '@ezd/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { api, ApiError, type DesignVersionSummary } from '../api/client';
import { versionsKey } from '../api/keys';
import { useCatalog } from '../catalog/useCatalog';
import { useConfig } from '../config/useConfig';
import { ChatPanel } from '../editor/chat/ChatPanel';
import { Editor } from '../editor/Editor';
import { BUTTON } from '../editor/panels/fields';
import { ConflictDialog, SaveStatus } from '../editor/panels/SaveStatus';
import { VersionsDialog } from '../editor/panels/VersionsDialog';
import { VersionPreview } from '../editor/VersionPreview';
import { PhotoReference } from '../photos/PhotoReference';
import { QuotesDialog } from '../quotes/QuotesDialog';
import {
  type Autosave,
  type BackupStore,
  createBackupStore,
  startServerAutosave,
} from '../lib/autosave';
import { readDocument } from '../lib/repository';
import { createServerRepository, type ServerDesignRepository } from '../lib/serverRepository';
import { exposeTestHook } from '../lib/testHook';
import { DesignStoreProvider } from '../store/context';
import { createDesignStore, type DesignStoreApi } from '../store/designStore';
import { errorMessage } from './format';
import { LINK, Page } from './ui';

/** One design open in the editor: its store, and the autosave that watches the store. */
type Session = { store: DesignStoreApi; autosave: Autosave; generation: number };
type Preview = { number: number; label: string; document: DesignDocument };

/** The store's document does not belong to the server yet: it is saved straight away. */
type Origin = 'server' | 'unsaved';

/**
 * Opens a design from the server and keeps the server up to date with it. The editor is
 * given a new store, with an empty history, whenever the document is replaced as a whole:
 * on load, on Reload theirs, on an imported file and on a restored version.
 */
function useDesignSession(designId: string) {
  const repository = useMemo(() => createServerRepository(designId), [designId]);
  const backup = useMemo(() => createBackupStore(designId), [designId]);
  const catalog = useCatalog();
  const [session, setSession] = useState<Session | null>(null);
  /** The session whose autosave is running, to stop it when another replaces it. */
  const running = useRef<Session | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  /** Counts loads from the server, so Reload theirs can ask for another. */
  const [reloads, setReloads] = useState(0);

  const open = useCallback(
    (doc: DesignDocument, origin: Origin, notice?: string) => {
      const store = createDesignStore(doc, catalog);
      if (notice) store.getState().notify(notice);
      const previous = running.current;
      previous?.autosave.stop({ flush: false });
      const autosave = startServerAutosave(store, repository, {
        revision: repository.revision,
        adoptServerRevision: repository.adoptServerRevision,
        backup,
        dirty: origin === 'unsaved',
      });
      running.current = { store, autosave, generation: (previous?.generation ?? 0) + 1 };
      setSession(running.current);
    },
    [repository, backup, catalog],
  );

  useEffect(() => {
    let cancelled = false;
    void load(repository, backup).then(
      (loaded) => {
        if (cancelled) return;
        if (loaded.doc) open(loaded.doc, loaded.origin, loaded.notice);
        else setFailure(new Error(loaded.notice));
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository, backup, open, reloads]);

  // Leaving the page sends what is unsaved, once.
  useEffect(
    () => () => {
      running.current?.autosave.stop();
      running.current = null;
    },
    [],
  );

  const reloadTheirs = useCallback(() => {
    backup.clear();
    setReloads((count) => count + 1);
  }, [backup]);

  return { repository, session, failure, open, reloadTheirs };
}

type Loaded = { doc: DesignDocument | null; origin: Origin; notice?: string };

/** The server's draft, or the newer work of this browser that never reached the server. */
async function load(repository: ServerDesignRepository, backup: BackupStore): Promise<Loaded> {
  const fromServer = await repository.load();
  const kept = backup.read();
  if (!kept) return { ...fromServer, origin: 'server' };
  // Saved from the revision it was made on. If the server has moved on since, that save
  // is refused and the user chooses between the two documents.
  repository.setRevision(kept.baseRevision);
  return {
    doc: kept.document,
    origin: 'unsaved',
    notice: 'Changes that were not saved last time were restored from this browser.',
  };
}

function useUnsavedWarning(autosave: Autosave | undefined) {
  useEffect(() => {
    if (!autosave) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.hasUnsavedChanges()) event.preventDefault();
    };
    const retry = () => void autosave.flush();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('online', retry);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('online', retry);
    };
  }, [autosave]);
}

export function DesignEditorPage() {
  const { id = '' } = useParams();
  // Keyed, so another design starts from nothing.
  return <DesignEditor key={id} designId={id} />;
}

function DesignEditor({ designId }: { designId: string }) {
  const queryClient = useQueryClient();
  const { repository, session, failure, open, reloadTheirs } = useDesignSession(designId);
  const { features } = useConfig();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [restoring, setRestoring] = useState(false);
  useUnsavedWarning(session?.autosave);

  useEffect(() => {
    if (session) exposeTestHook(session.store);
  }, [session]);

  if (failure) {
    const missing = failure instanceof ApiError && failure.status === 404;
    return (
      <Page title={missing ? 'Design not found' : 'The design could not be opened'}>
        <p className="text-sm text-slate-600">
          {missing ? 'This design does not exist or was deleted.' : errorMessage(failure)}{' '}
          <Link to="/projects" className={LINK}>
            Back to projects
          </Link>
        </p>
      </Page>
    );
  }
  if (!session) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        <h1 className="sr-only">EZDesign</h1>
        <p role="status">Loading the design…</p>
      </main>
    );
  }

  const { store, autosave, generation } = session;
  const design = repository.design();

  // An imported file becomes this design's draft, so it takes this design's id.
  const loadDocument = (doc: DesignDocument) => open({ ...doc, id: designId }, 'unsaved');

  const restore = async (number: number) => {
    setRestoring(true);
    try {
      // The restored draft replaces whatever is unsaved here, so nothing more is sent.
      autosave.stop({ flush: false });
      const restored = await repository.restoreVersion(number);
      if (!restored.doc) throw new Error(restored.notice);
      createBackupStore(designId).clear();
      open(restored.doc, 'server', `Version ${number} was restored.`);
      setPreview(null);
    } catch (error) {
      // Back to autosaving the draft that is still on screen.
      open(store.getState().doc, autosave.hasUnsavedChanges() ? 'unsaved' : 'server');
      throw error;
    } finally {
      setRestoring(false);
    }
  };

  const showPreview = async (version: DesignVersionSummary) => {
    try {
      const full = await queryClient.fetchQuery({
        queryKey: [...versionsKey(designId), version.number],
        queryFn: () => api.getVersion(designId, version.number),
        staleTime: Infinity,
      });
      const read = readDocument(JSON.stringify(full.document));
      if (!read.ok) throw new Error(read.error.message);
      setPreview({ number: version.number, label: version.label, document: read.value });
    } catch (error) {
      store
        .getState()
        .notify(`Version ${version.number} could not be opened: ${errorMessage(error)}`);
    }
  };

  if (preview) {
    return (
      <VersionPreview
        document={preview.document}
        number={preview.number}
        label={preview.label}
        restoring={restoring}
        onRestore={() =>
          void restore(preview.number).catch((error: unknown) => {
            setPreview(null);
            store.getState().notify(`The version was not restored: ${errorMessage(error)}`);
          })
        }
        onClose={() => setPreview(null)}
      />
    );
  }

  const header = (
    <>
      <span className="text-sm text-slate-700" data-testid="design-name">
        {design?.name}
      </span>
      <SaveStatus autosave={autosave} />
      {features.versions && (
        <VersionsDialog
          designId={designId}
          trigger={
            <button type="button" className={BUTTON}>
              Versions
            </button>
          }
          beforeSave={async () => {
            await autosave.flush();
            if (autosave.hasUnsavedChanges()) {
              throw new Error('The design has changes that could not be saved yet.');
            }
          }}
          onPreview={(version) => void showPreview(version)}
          onRestore={(version) => restore(version.number)}
        />
      )}
      {features.quotes && (
        <QuotesDialog
          designId={designId}
          trigger={
            <button type="button" className={BUTTON}>
              Quotes
            </button>
          }
          beforeQuote={async () => {
            await autosave.flush();
            if (autosave.hasUnsavedChanges()) {
              throw new Error('The design has changes that could not be saved yet.');
            }
            return repository.revision();
          }}
        />
      )}
      {design?.source_photo && <PhotoReference photoId={design.source_photo} />}
      <nav aria-label="Design" className="ml-auto flex items-center gap-3 pb-1 text-sm">
        {design && (
          <Link to={`/projects/${design.project}`} className={LINK}>
            Back to project
          </Link>
        )}
      </nav>
    </>
  );

  return (
    <DesignStoreProvider store={store}>
      {/* Keyed by store, so nothing typed or hovered carries over to a replaced document. */}
      <Editor
        key={generation}
        onLoadDocument={loadDocument}
        header={header}
        assistant={<ChatPanel designId={designId} />}
      />
      <ConflictDialog autosave={autosave} onReloadTheirs={reloadTheirs} />
    </DesignStoreProvider>
  );
}
