import type { DesignDocument } from '@ezd/core';

import type { Viewport } from '../editor/viewport';
import type { DesignStoreApi } from '../store/designStore';

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

/** Lets the end-to-end tests read the design that is open in the editor. */
export function exposeTestHook(store: DesignStoreApi): void {
  if (!EXPOSE_TEST_HOOK) return;
  window.__ezd = {
    getDoc: () => store.getState().doc,
    getHistoryLength: () => store.getState().history.past.length,
    getViewport: () => store.getState().viewport,
  };
}
