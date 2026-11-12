import type { DesignDocument } from '@ezd/core';

import { type Api, api as defaultApi, type Design } from '../api/client';
import { type DesignRepository, type LoadResult, readDocument } from './repository';

/**
 * One design kept on the server. It remembers the revision of the draft it last read or
 * wrote, which every save sends back so the server can refuse a stale one with a 409.
 */
export interface ServerDesignRepository extends DesignRepository {
  readonly designId: string;
  /** The design as last loaded: its name and project. Null before the first load. */
  design(): Design | null;
  /** The draft revision the next save is based on. */
  revision(): number;
  /** Bases the next save on the given revision, such as that of a local backup. */
  setRevision(revision: number): void;
  /** Reads the server's current revision, so the next save overwrites what is there. */
  adoptServerRevision(): Promise<void>;
  /** Replaces the draft with a snapshot and returns the new draft. */
  restoreVersion(number: number): Promise<LoadResult>;
}

export function createServerRepository(
  designId: string,
  api: Api = defaultApi,
): ServerDesignRepository {
  let loaded: Design | null = null;
  let revision = 0;

  const adopt = (design: Design): LoadResult => {
    loaded = design;
    revision = design.draft_revision;
    const read = readDocument(JSON.stringify(design.draft_document));
    if (read.ok) return { doc: read.value };
    return { doc: null, notice: `The saved design could not be read: ${read.error.message}` };
  };

  return {
    designId,
    design: () => loaded,
    revision: () => revision,
    setRevision(next) {
      revision = next;
    },
    async load() {
      return adopt(await api.getDesign(designId));
    },
    /** Rejects with the API's error; a 409 means the draft changed elsewhere. */
    async save(doc: DesignDocument) {
      const saved = await api.saveDraft(designId, doc, revision);
      revision = saved.draft_revision;
    },
    async adoptServerRevision() {
      revision = (await api.getDesign(designId)).draft_revision;
    },
    async restoreVersion(number) {
      return adopt(await api.restoreVersion(designId, number));
    },
  };
}
