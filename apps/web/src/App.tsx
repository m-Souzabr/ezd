import { createEmptyDocument, type DesignDocument } from '@ezd/core';
import { useEffect, useMemo, useState } from 'react';

import { Editor } from './editor/Editor';
import { newId } from './editor/ids';
import type { Viewport } from './editor/viewport';
import { createLocalRepository, type DesignRepository, startAutosave } from './lib/repository';
import { DesignStoreProvider } from './store/context';
import { createDesignStore, type DesignStoreApi } from './store/designStore';

declare global {
  interface Window {
    /** For end-to-end tests. Present in development and test builds only. */
    __ezd?: {
      getDoc(): DesignDocument;
      getHistoryLength(): number;
      /** Pixels per inch and the canvas position of the origin, to aim the mouse. */
      getViewport(): Viewport;
    };
  }
}

const EXPOSE_TEST_HOOK = import.meta.env.DEV || import.meta.env.MODE === 'test';

const newDocument = (): DesignDocument =>
  createEmptyDocument({ id: newId('design'), name: 'Untitled kitchen' });

/**
 * Loads the design from the repository, then shows the editor on a store for it. An
 * imported design replaces the store, so its history starts empty.
 */
export function App({ repository: given }: { repository?: DesignRepository }) {
  const repository = useMemo(() => given ?? createLocalRepository(), [given]);
  const [store, setStore] = useState<DesignStoreApi | null>(null);
  /** How many designs have been imported. Zero while the stored design is open. */
  const [generation, setGeneration] = useState(0);
  const imported = generation > 0;

  useEffect(() => {
    let cancelled = false;
    void repository.load().then(({ doc, notice }) => {
      if (cancelled) return;
      const loaded = createDesignStore(doc ?? newDocument());
      if (notice) loaded.getState().notify(notice);
      setStore(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    if (!store) return;
    if (EXPOSE_TEST_HOOK) {
      window.__ezd = {
        getDoc: () => store.getState().doc,
        getHistoryLength: () => store.getState().history.past.length,
        getViewport: () => store.getState().viewport,
      };
    }
    // Stopping the autosave of the design this one replaced may have saved that design
    // once more, so this one is saved after it.
    if (imported) void repository.save(store.getState().doc);
    return startAutosave(store, repository);
  }, [store, repository, imported]);

  if (!store) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        <h1 className="sr-only">EZDesign</h1>
        <p role="status">Loading the design…</p>
      </main>
    );
  }

  const loadDocument = (doc: DesignDocument) => {
    setStore(createDesignStore(doc));
    setGeneration((current) => current + 1);
  };

  return (
    <DesignStoreProvider store={store}>
      {/* Keyed by design, so nothing typed or hovered carries over to an imported one. */}
      <Editor key={generation} onLoadDocument={loadDocument} />
    </DesignStoreProvider>
  );
}
