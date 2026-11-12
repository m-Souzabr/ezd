import { type DesignDocument, err, type Issue, migrate, type Result } from '@ezd/core';

import type { DesignStoreApi } from '../store/designStore';

// Where designs are kept. `createLocalRepository` keeps one design in the browser, for use
// without an account; `createServerRepository` (serverRepository.ts) keeps a design of a
// signed-in user on the server, behind the same interface.

export type LoadResult = {
  /** Null when nothing is stored, or what was stored could not be used. */
  doc: DesignDocument | null;
  /** Something the user should be told, such as a corrupt design that was discarded. */
  notice?: string;
};

export interface DesignRepository {
  load(): Promise<LoadResult>;
  save(doc: DesignDocument): Promise<void>;
}

export const STORAGE_KEY = 'ezd.design';
/** How long after the last command the design is saved. */
export const AUTOSAVE_DELAY_MS = 500;

export type ReadError = { message: string; issues: Issue[] };

export const serializeDocument = (doc: DesignDocument): string => JSON.stringify(doc, null, 2);

/** Reads exported or stored JSON through `migrate`, which also validates it. */
export function readDocument(text: string): Result<DesignDocument, ReadError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ message: 'The file is not valid JSON.', issues: [] });
  }
  const migrated = migrate(json);
  if (migrated.ok) return migrated;
  return err({ message: migrated.error.message, issues: migrated.error.issues ?? [] });
}

/**
 * Keeps one design in `localStorage`. Every access is guarded, so the editor still works
 * when storage is unavailable or full: nothing is restored and nothing is saved.
 */
export function createLocalRepository(
  getStorage: () => Storage = () => window.localStorage,
  key: string = STORAGE_KEY,
): DesignRepository {
  return {
    async load() {
      let text: string | null;
      try {
        text = getStorage().getItem(key);
      } catch {
        return { doc: null };
      }
      if (text === null) return { doc: null };
      const read = readDocument(text);
      if (read.ok) return { doc: read.value };
      try {
        getStorage().removeItem(key);
      } catch {
        // Nothing to do: the entry is ignored either way.
      }
      return {
        doc: null,
        notice: 'The saved design could not be read and was discarded. Starting a new design.',
      };
    },
    async save(doc) {
      try {
        getStorage().setItem(key, serializeDocument(doc));
      } catch {
        // Storage is unavailable or full. The design stays in memory.
      }
    },
  };
}

/** Forgets the design kept in this browser, as after it was imported into an account. */
export function clearLocalDesign(
  getStorage: () => Storage = () => window.localStorage,
  key: string = STORAGE_KEY,
): void {
  try {
    getStorage().removeItem(key);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

/**
 * Saves the store's document `delay` ms after the last change to it. Returns a function
 * that stops saving; a save that is pending then still runs, so nothing is lost.
 */
export function startAutosave(
  store: DesignStoreApi,
  repository: DesignRepository,
  delay: number = AUTOSAVE_DELAY_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    void repository.save(store.getState().doc);
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  return () => {
    unsubscribe();
    flush();
  };
}

/** Offers the document as a JSON file download. */
export function downloadDocument(doc: DesignDocument): void {
  const url = URL.createObjectURL(new Blob([serializeDocument(doc)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${doc.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'design'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
