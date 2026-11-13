import { createEmptyDocument, type DesignDocument } from '@ezd/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { Editor } from '../editor/Editor';
import { newId } from '../editor/ids';
import { createLocalRepository, type DesignRepository, startAutosave } from '../lib/repository';
import { exposeTestHook } from '../lib/testHook';
import { DesignStoreProvider } from '../store/context';
import { createDesignStore, type DesignStoreApi } from '../store/designStore';

const newDocument = (): DesignDocument =>
  createEmptyDocument({ id: newId('design'), name: 'Untitled kitchen' });

/**
 * The editor on the one design kept in this browser, for use without an account. Loads
 * the design from the repository, then shows the editor on a store for it. An imported
 * design replaces the store, so its history starts empty.
 */
export function LocalEditor({
  repository: given,
  header,
}: {
  repository?: DesignRepository;
  /** Shown in the editor's header, after the title. */
  header?: ReactNode;
}) {
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
    exposeTestHook(store);
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
      <Editor key={generation} onLoadDocument={loadDocument} header={header} />
    </DesignStoreProvider>
  );
}
