import type { DesignDocument } from '@ezd/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NetworkError } from '../api/client';
import { createDesignStore, type DesignStoreApi } from '../store/designStore';
import { room, WALLS } from '../test/kitchen';
import {
  backupKey,
  createBackupStore,
  SERVER_AUTOSAVE_DELAY_MS,
  startServerAutosave,
} from './autosave';
import type { DesignRepository } from './repository';

const DESIGN_ID = 'design-0001';
const [A] = WALLS;
const kitchen = (): DesignDocument => ({ ...room(144, 120), id: DESIGN_ID });

type Pending = { doc: DesignDocument; resolve(): void; reject(error: unknown): void };

/** A repository whose saves stay open until the test settles them. */
function manualRepository() {
  const pending: Pending[] = [];
  const saves: DesignDocument[] = [];
  let revision = 1;
  const repository: DesignRepository = {
    load: async () => ({ doc: null }),
    save: (doc) =>
      new Promise<void>((resolve, reject) => {
        saves.push(doc);
        pending.push({
          doc,
          resolve: () => {
            revision += 1;
            resolve();
          },
          reject,
        });
      }),
  };
  const options = {
    revision: () => revision,
    adoptServerRevision: vi.fn(async () => {
      revision = 7;
    }),
  };
  /** Settles the oldest open save and lets its handlers run. */
  const settle = async (error?: unknown) => {
    const next = pending.shift();
    if (!next) throw new Error('No save is on its way');
    if (error === undefined) next.resolve();
    else next.reject(error);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { repository, options, saves, pending, settle };
}

let count = 0;
/** One command that changes the document. */
function edit(store: DesignStoreApi) {
  count += 1;
  const executed = store.getState().execute({ type: 'document.rename', name: `Kitchen ${count}` });
  if (!executed.ok) throw new Error(executed.error.message);
}

const offline = () => new NetworkError();
const conflict = () => new ApiError(409, { detail: 'changed elsewhere', draft_revision: 5 });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  count = 0;
});
afterEach(() => void vi.useRealTimers());

describe('server autosave: debounce', () => {
  it('saves 2 seconds after the last command, not after each one', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);
    expect(autosave.status()).toBe('saved');
    expect(autosave.hasUnsavedChanges()).toBe(false);

    edit(store);
    expect(autosave.status()).toBe('saving');
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS - 1);
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS - 1);
    expect(saves).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toEqual([store.getState().doc]);
    expect(autosave.status()).toBe('saving');

    await settle();
    expect(autosave.status()).toBe('saved');
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });

  it('does not save when only the selection or the view changed', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    store.getState().select([A]);
    store.getState().setView({ kind: 'elevation', wallId: A });
    expect(autosave.status()).toBe('saved');
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS * 2);

    expect(saves).toEqual([]);
  });

  it('tells its listeners when the status changes', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);
    const seen: string[] = [];
    const unsubscribe = autosave.subscribe(() => seen.push(autosave.status()));

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle();
    unsubscribe();
    edit(store);

    expect(seen).toEqual(['saving', 'saved']);
  });
});

describe('server autosave: single flight', () => {
  it('keeps one request on its way and sends the latest document after it', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, pending, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    const first = store.getState().doc;
    edit(store);
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS * 3);
    // The debounce has passed twice over, but the first request is still open.
    expect(saves).toEqual([first]);
    expect(pending).toHaveLength(1);

    await settle();
    // The newer document stayed on screen and is what goes next.
    expect(autosave.status()).toBe('saving');
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    expect(saves).toEqual([first, store.getState().doc]);
    expect(pending).toHaveLength(1);

    await settle();
    expect(autosave.status()).toBe('saved');
  });

  it('flush saves at once and waits for a request that is on its way', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    edit(store);
    void autosave.flush();
    expect(saves).toHaveLength(1);
    edit(store);
    let flushed = false;
    void autosave.flush().then(() => (flushed = true));
    expect(saves).toHaveLength(1);

    await settle();
    expect(saves).toEqual([saves[0], store.getState().doc]);
    expect(flushed).toBe(false);
    await settle();
    expect(flushed).toBe(true);
    expect(autosave.status()).toBe('saved');
  });

  it('stop sends unsaved changes once more, and then nothing', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    edit(store);
    autosave.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toEqual([store.getState().doc]);
    await settle();

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS * 2);
    expect(saves).toHaveLength(1);
  });

  it('stop without flush sends nothing', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    edit(store);
    autosave.stop({ flush: false });
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS * 2);

    expect(saves).toEqual([]);
  });
});

describe('server autosave: 409', () => {
  it('stops on a conflict until the user overwrites', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const backup = createBackupStore(DESIGN_ID);
    const autosave = startServerAutosave(store, repository, { ...options, backup });

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle(conflict());
    expect(autosave.status()).toBe('conflict');
    expect(autosave.hasUnsavedChanges()).toBe(true);

    // Editing goes on, nothing is sent, and the work is kept in the browser.
    edit(store);
    await vi.advanceTimersByTimeAsync(60_000);
    await autosave.flush();
    expect(saves).toHaveLength(1);
    expect(autosave.status()).toBe('conflict');
    expect(backup.read()?.document).toEqual(store.getState().doc);

    // Overwrite reads the server's revision and saves this document on top of it.
    const overwritten = autosave.overwrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(options.adoptServerRevision).toHaveBeenCalledTimes(1);
    expect(saves).toEqual([saves[0], store.getState().doc]);
    expect(autosave.status()).toBe('saving');
    await settle();
    await overwritten;
    expect(autosave.status()).toBe('saved');
    expect(backup.read()).toBeNull();

    // And autosave is running again.
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    expect(saves).toHaveLength(3);
  });

  it('stays in conflict when the revision cannot be read', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    options.adoptServerRevision.mockRejectedValueOnce(offline());
    const autosave = startServerAutosave(store, repository, options);
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle(conflict());

    await autosave.overwrite();

    expect(autosave.status()).toBe('conflict');
    expect(saves).toHaveLength(1);
  });

  it('overwrite does nothing without a conflict', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);

    await autosave.overwrite();

    expect(options.adoptServerRevision).not.toHaveBeenCalled();
  });
});

describe('server autosave: offline', () => {
  it('keeps a backup and retries with a growing wait until the save succeeds', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const backup = createBackupStore(DESIGN_ID);
    const autosave = startServerAutosave(store, repository, { ...options, backup });

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle(offline());
    expect(autosave.status()).toBe('offline');
    expect(backup.read()).toEqual({ document: store.getState().doc, baseRevision: 1 });

    // Retries after 1 s, then 2 s, then 4 s.
    for (const [wait, attempts] of [
      [1000, 2],
      [2000, 3],
      [4000, 4],
    ] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(saves).toHaveLength(attempts - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(saves).toHaveLength(attempts);
      if (attempts < 4) await settle(new ApiError(503, null));
      expect(autosave.status()).toBe('offline');
    }

    await settle();
    expect(autosave.status()).toBe('saved');
    expect(backup.read()).toBeNull();
    expect(localStorage.getItem(backupKey(DESIGN_ID))).toBeNull();
  });

  it('lets editing continue while offline and saves the latest document', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const backup = createBackupStore(DESIGN_ID);
    const autosave = startServerAutosave(store, repository, { ...options, backup });
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle(offline());

    edit(store);
    expect(autosave.status()).toBe('offline');
    expect(backup.read()?.document).toEqual(store.getState().doc);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    expect(saves.at(-1)).toBe(store.getState().doc);
    await settle();

    expect(autosave.status()).toBe('saved');
  });

  it('caps the wait between retries at 30 seconds', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    for (let failed = 0; failed < 8; failed += 1) {
      await settle(offline());
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(saves).toHaveLength(9);
    expect(autosave.status()).toBe('offline');
  });

  it('reports another refusal as an error and tries again on the next change', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, options);
    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    await settle(new ApiError(422, { detail: 'invalid' }));
    expect(autosave.status()).toBe('error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saves).toHaveLength(1);

    edit(store);
    await vi.advanceTimersByTimeAsync(SERVER_AUTOSAVE_DELAY_MS);
    expect(saves).toHaveLength(2);
  });
});

describe('server autosave: a restored backup', () => {
  it('saves at once when it starts with unsaved work', async () => {
    const store = createDesignStore(kitchen());
    const { repository, options, saves, settle } = manualRepository();
    const autosave = startServerAutosave(store, repository, { ...options, dirty: true });

    expect(autosave.status()).toBe('saving');
    expect(autosave.hasUnsavedChanges()).toBe(true);
    expect(saves).toEqual([store.getState().doc]);
    await settle();
    expect(autosave.status()).toBe('saved');
  });

  it('reads back only a valid backup of the same design', () => {
    const backup = createBackupStore(DESIGN_ID);
    expect(backup.read()).toBeNull();

    backup.write({ document: kitchen(), baseRevision: 4 });
    expect(backup.read()).toEqual({ document: kitchen(), baseRevision: 4 });
    expect(createBackupStore('design-0002').read()).toBeNull();

    localStorage.setItem(backupKey(DESIGN_ID), '{"document":{"schemaVersion":1},"baseRevision":4}');
    expect(backup.read()).toBeNull();
    localStorage.setItem(backupKey(DESIGN_ID), 'not json');
    expect(backup.read()).toBeNull();
    localStorage.setItem(
      backupKey(DESIGN_ID),
      JSON.stringify({ document: { ...kitchen(), id: 'design-9999' }, baseRevision: 4 }),
    );
    expect(backup.read()).toBeNull();
  });

  it('works without storage', () => {
    const backup = createBackupStore(DESIGN_ID, () => {
      throw new Error('storage is blocked');
    });
    backup.write({ document: kitchen(), baseRevision: 1 });
    backup.clear();
    expect(backup.read()).toBeNull();
  });
});
