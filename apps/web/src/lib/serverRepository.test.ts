import type { DesignDocument } from '@ezd/core';
import { describe, expect, it, vi } from 'vitest';

import { type Api, ApiError, type Design } from '../api/client';
import { room } from '../test/kitchen';
import { createServerRepository } from './serverRepository';

const DESIGN_ID = 'design-0001';
const kitchen = (name = 'Kitchen'): DesignDocument => ({ ...room(144, 120), id: DESIGN_ID, name });

const design = (document: object, revision: number): Design => ({
  id: DESIGN_ID,
  project: 'project-1',
  name: 'Kitchen',
  draft_document: document as Design['draft_document'],
  draft_revision: revision,
  schema_version: 1,
  source_photo: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

function fakeApi(overrides: Partial<Api>): Api {
  return new Proxy(overrides as Api, {
    get(target, key: string) {
      if (key in target) return target[key as keyof Api];
      throw new Error(`Unexpected call to api.${key}`);
    },
  });
}

describe('the server repository', () => {
  it('loads the draft through migrate and remembers its revision', async () => {
    const repository = createServerRepository(
      DESIGN_ID,
      fakeApi({ getDesign: vi.fn(async () => design(kitchen(), 3)) }),
    );
    expect(repository.design()).toBeNull();

    const loaded = await repository.load();

    expect(loaded).toEqual({ doc: kitchen() });
    expect(repository.revision()).toBe(3);
    expect(repository.design()?.project).toBe('project-1');
  });

  it('gives a notice instead of a document it cannot read', async () => {
    const repository = createServerRepository(
      DESIGN_ID,
      fakeApi({ getDesign: async () => design({ schemaVersion: 99 }, 3) }),
    );

    const loaded = await repository.load();

    expect(loaded.doc).toBeNull();
    expect(loaded.notice).toMatch(/^The saved design could not be read: /);
  });

  it('saves from the revision it knows and moves on to the one it gets back', async () => {
    const saveDraft = vi.fn(async (_id: string, _doc: object, base: number) => ({
      draft_revision: base + 1,
      updated_at: '2026-01-01T00:00:00Z',
    }));
    const repository = createServerRepository(
      DESIGN_ID,
      fakeApi({ getDesign: async () => design(kitchen(), 3), saveDraft }),
    );
    await repository.load();

    await repository.save(kitchen('First'));
    await repository.save(kitchen('Second'));

    expect(saveDraft.mock.calls).toEqual([
      [DESIGN_ID, kitchen('First'), 3],
      [DESIGN_ID, kitchen('Second'), 4],
    ]);
    expect(repository.revision()).toBe(5);
  });

  it('keeps its revision when a save is refused', async () => {
    const repository = createServerRepository(
      DESIGN_ID,
      fakeApi({
        getDesign: async () => design(kitchen(), 3),
        saveDraft: async () => {
          throw new ApiError(409, { draft_revision: 8 });
        },
      }),
    );
    await repository.load();

    await expect(repository.save(kitchen())).rejects.toMatchObject({ status: 409 });

    expect(repository.revision()).toBe(3);
  });

  it('adopts the revision of the server to overwrite it, or one that is given', async () => {
    const getDesign = vi
      .fn<Api['getDesign']>()
      .mockResolvedValueOnce(design(kitchen(), 3))
      .mockResolvedValueOnce(design(kitchen('Theirs'), 8));
    const repository = createServerRepository(DESIGN_ID, fakeApi({ getDesign }));
    await repository.load();

    await repository.adoptServerRevision();
    expect(repository.revision()).toBe(8);

    repository.setRevision(2);
    expect(repository.revision()).toBe(2);
  });

  it('restores a version and continues from the new revision', async () => {
    const restoreVersion = vi.fn(async () => design(kitchen('Restored'), 6));
    const repository = createServerRepository(
      DESIGN_ID,
      fakeApi({ getDesign: async () => design(kitchen(), 3), restoreVersion }),
    );
    await repository.load();

    const restored = await repository.restoreVersion(2);

    expect(restoreVersion).toHaveBeenCalledWith(DESIGN_ID, 2);
    expect(restored).toEqual({ doc: kitchen('Restored') });
    expect(repository.revision()).toBe(6);
  });
});
