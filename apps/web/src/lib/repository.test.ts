import { inches, parseDocument } from '@ezd/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { room, seedItem, storeFor, WALLS } from '../test/kitchen';
import {
  AUTOSAVE_DELAY_MS,
  createLocalRepository,
  type DesignRepository,
  readDocument,
  serializeDocument,
  startAutosave,
  STORAGE_KEY,
} from './repository';

const [A] = WALLS;
const kitchen = () =>
  room(144, 120, seedItem('item-000001', 'base.standard', A, 12), {
    ...seedItem('item-000002', 'filler.base', A, 42),
    width: inches(2.5),
    finishId: 'cabinet.navy',
  });

/** A `Storage` that keeps its entries in a map. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

const brokenStorage = (): Storage => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

describe('export and import', () => {
  it('yields an identical document', () => {
    const doc = kitchen();
    const read = readDocument(serializeDocument(doc));
    expect(read.ok && read.value).toEqual(doc);
    // And again, so nothing drifts over repeated round trips.
    expect(read.ok && serializeDocument(read.value)).toBe(serializeDocument(doc));
  });

  it('shows the schema errors of a bad file instead of loading it', () => {
    const bad = { ...kitchen(), items: [{ ...kitchen().items[0], width: 30.5 }] };
    const read = readDocument(JSON.stringify(bad));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.message).toContain('Invalid document');
    expect(read.error.issues).toEqual([expect.objectContaining({ path: 'items[0].width' })]);
  });

  it('rejects text that is not JSON and JSON that is not a design', () => {
    const notJson = readDocument('{ not json');
    expect(!notJson.ok && notJson.error.message).toBe('The file is not valid JSON.');
    const notDesign = readDocument('{"hello":"world"}');
    expect(!notDesign.ok && notDesign.error.message).toContain('Not a design document');
    const newer = readDocument(JSON.stringify({ ...kitchen(), schemaVersion: 99 }));
    expect(!newer.ok && newer.error.message).toContain('newer than this build supports');
  });
});

describe('the local repository', () => {
  it('saves a design and loads it back through migrate and parseDocument', async () => {
    const storage = memoryStorage();
    const repository = createLocalRepository(() => storage);
    expect(await repository.load()).toEqual({ doc: null });

    const doc = kitchen();
    await repository.save(doc);
    const loaded = await repository.load();
    expect(loaded).toEqual({ doc });
    expect(parseDocument(loaded.doc).ok).toBe(true);
  });

  it('discards a corrupt entry with a notice', async () => {
    for (const corrupt of ['{ not json', '{"schemaVersion":1,"id":"x"}', '"just a string"']) {
      const storage = memoryStorage({ [STORAGE_KEY]: corrupt });
      const loaded = await createLocalRepository(() => storage).load();
      expect(loaded.doc).toBeNull();
      expect(loaded.notice).toMatch(/could not be read and was discarded/);
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    }
  });

  it('works when storage is unavailable', async () => {
    const repository = createLocalRepository(brokenStorage);
    expect(await repository.load()).toEqual({ doc: null });
    await expect(repository.save(kitchen())).resolves.toBeUndefined();
  });

  it('works when storage is full', async () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    await expect(createLocalRepository(() => storage).save(kitchen())).resolves.toBeUndefined();
  });
});

describe('autosave', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const move = (offset: number) => ({
    type: 'item.move' as const,
    id: 'item-000001',
    placement: { type: 'wall' as const, wallId: A, offset: inches(offset) },
  });
  const recorder = () => {
    const saved: unknown[] = [];
    const repository: DesignRepository = {
      load: async () => ({ doc: null }),
      save: async (doc) => void saved.push(doc),
    };
    return { saved, repository };
  };

  it('saves 500 ms after the last command', () => {
    const store = storeFor(kitchen());
    const { saved, repository } = recorder();
    startAutosave(store, repository);

    store.getState().execute(move(15));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
    store.getState().execute(move(18));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(saved).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(saved).toEqual([store.getState().doc]);
    expect(AUTOSAVE_DELAY_MS).toBe(500);
  });

  it('saves after undo and redo too, and not for changes that leave the document alone', () => {
    const store = storeFor(kitchen());
    const { saved, repository } = recorder();
    startAutosave(store, repository);

    store.getState().select(['item-000001']);
    store.getState().setTool('wall');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(saved).toEqual([]);

    store.getState().execute(move(15));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    store.getState().undo();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(saved).toHaveLength(2);
    expect(saved[1]).toEqual(kitchen());
  });

  it('saves what is pending when it is stopped, then stops', () => {
    const store = storeFor(kitchen());
    const { saved, repository } = recorder();
    const stop = startAutosave(store, repository);

    store.getState().execute(move(15));
    stop();
    expect(saved).toEqual([store.getState().doc]);

    store.getState().execute(move(18));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(saved).toHaveLength(1);
  });
});
