import type { DesignDocument } from '@ezd/core';

import { isConflict, isRetriable } from '../api/client';
import type { DesignStoreApi } from '../store/designStore';
import { type DesignRepository, readDocument } from './repository';

// Autosave of a design kept on the server. Unlike the `localStorage` one in
// repository.ts, a save here can fail, be refused as stale, or still be on its way when
// the next change is made.

/** How long after the last command the design is saved. */
export const SERVER_AUTOSAVE_DELAY_MS = 2000;
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export type SaveStatus =
  /** The server has the document on screen. */
  | 'saved'
  /** There are changes that are waiting to be sent or are on their way. */
  | 'saving'
  /** The server could not be reached. Saving is retried, with longer and longer waits. */
  | 'offline'
  /** The design was changed elsewhere. Autosave is stopped until the user chooses. */
  | 'conflict'
  /** The server refused the save for another reason. Tried again on the next change. */
  | 'error';

export interface Autosave {
  status(): SaveStatus;
  subscribe(listener: () => void): () => void;
  /** Whether the document on screen differs from what the server is known to have. */
  hasUnsavedChanges(): boolean;
  /** Saves now instead of after the delay, and resolves when that attempt has ended. */
  flush(): Promise<void>;
  /** After a conflict: saves this document over the server's and resumes autosave. */
  overwrite(): Promise<void>;
  /** Stops watching the store. With `flush`, one last save of unsaved changes is sent. */
  stop(options?: { flush: boolean }): void;
}

/** A copy of unsaved work in the browser, in case the tab closes before a save succeeds. */
export type Backup = { document: DesignDocument; baseRevision: number };

export interface BackupStore {
  read(): Backup | null;
  write(backup: Backup): void;
  clear(): void;
}

export const backupKey = (designId: string): string => `ezd.backup.${designId}`;

/** Every access is guarded: without storage there is simply no backup. */
export function createBackupStore(
  designId: string,
  getStorage: () => Storage = () => window.localStorage,
): BackupStore {
  const key = backupKey(designId);
  return {
    read() {
      try {
        const text = getStorage().getItem(key);
        if (text === null) return null;
        const parsed = JSON.parse(text) as Partial<Backup>;
        if (typeof parsed.baseRevision !== 'number') return null;
        const read = readDocument(JSON.stringify(parsed.document));
        if (!read.ok || read.value.id !== designId) return null;
        return { document: read.value, baseRevision: parsed.baseRevision };
      } catch {
        return null;
      }
    },
    write(backup) {
      try {
        getStorage().setItem(key, JSON.stringify(backup));
      } catch {
        // Storage is unavailable or full. The design stays in memory.
      }
    },
    clear() {
      try {
        getStorage().removeItem(key);
      } catch {
        // Nothing to do.
      }
    },
  };
}

type Options = {
  delay?: number;
  /** The revision the next save is based on, to store with a backup. */
  revision(): number;
  /** Reads the server's revision so that the next save replaces what is there. */
  adoptServerRevision(): Promise<void>;
  backup?: BackupStore;
  /** The store's document is not what the server has, as after restoring a backup. */
  dirty?: boolean;
};

/**
 * Saves the store's document `delay` ms after the last change to it, with at most one
 * request on its way. A change made during a request stays on screen and is sent after it.
 */
export function startServerAutosave(
  store: DesignStoreApi,
  repository: DesignRepository,
  options: Options,
): Autosave {
  const delay = options.delay ?? SERVER_AUTOSAVE_DELAY_MS;
  const listeners = new Set<() => void>();
  /** The document the server is known to have, or null when that is not known. */
  let saved = options.dirty ? null : store.getState().doc;
  let status: SaveStatus = options.dirty ? 'saving' : 'saved';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let stopped = false;

  const dirty = () => store.getState().doc !== saved;
  const setStatus = (next: SaveStatus) => {
    if (status === next) return;
    status = next;
    listeners.forEach((listener) => listener());
  };
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), ms);
  };
  const keepBackup = () =>
    options.backup?.write({ document: store.getState().doc, baseRevision: options.revision() });

  async function attempt(): Promise<void> {
    const doc = store.getState().doc;
    try {
      await repository.save(doc);
    } catch (error) {
      keepBackup();
      if (isConflict(error)) {
        setStatus('conflict');
      } else if (isRetriable(error)) {
        setStatus('offline');
        if (!stopped) schedule(Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS));
        failures += 1;
      } else {
        setStatus('error');
      }
      return;
    }
    saved = doc;
    failures = 0;
    if (dirty()) {
      // Changed while the request was on its way: the newer document is sent next.
      keepBackup();
      setStatus('saving');
      if (timer === undefined && !stopped) schedule(delay);
    } else {
      options.backup?.clear();
      setStatus('saved');
    }
  }

  function save(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (inFlight) return inFlight;
    if (!dirty() || status === 'conflict') return Promise.resolve();
    inFlight = attempt().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    if (status === 'conflict') {
      // Autosave is stopped, but the work is not left in memory alone.
      keepBackup();
      return;
    }
    if (status === 'offline' || status === 'error') keepBackup();
    if (status !== 'offline') setStatus('saving');
    failures = 0;
    schedule(delay);
  });

  if (options.dirty) void save();

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasUnsavedChanges: dirty,
    async flush() {
      // A request already on its way may carry an older document, so one more follows.
      if (inFlight) await inFlight;
      await save();
    },
    async overwrite() {
      if (status !== 'conflict') return;
      try {
        await options.adoptServerRevision();
      } catch {
        // Still a conflict; the user can try again.
        return;
      }
      setStatus('saving');
      await save();
    },
    stop({ flush } = { flush: true }) {
      stopped = true;
      unsubscribe();
      clearTimeout(timer);
      timer = undefined;
      if (!flush) return;
      // After a request that is on its way, in case the document changed during it.
      void (inFlight ?? Promise.resolve()).then(() => {
        if (dirty() && status !== 'conflict') return attempt();
      });
    },
  };
}
