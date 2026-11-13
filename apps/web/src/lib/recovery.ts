import type { DesignDocument } from '@ezd/core';

// What the error boundary can still save after a crash: the document of the design that
// was open. The editor registers its store; the registration outlives the crashed tree on
// purpose, since that tree is what unmounts.

let source: (() => DesignDocument) | null = null;

export function registerRecoverySource(get: () => DesignDocument): void {
  source = get;
}

/** The open design's document, or null when no design was open or it cannot be read. */
export function recoverableDocument(): DesignDocument | null {
  try {
    return source?.() ?? null;
  } catch {
    return null;
  }
}
