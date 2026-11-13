// A vendor-neutral hook for reporting errors. Nothing is sent anywhere by default; an
// adapter for an error tracker is set once at startup (see docs/OPERATIONS.md). Never pass
// design content, photos, emails or keys in `context`.

export type ErrorContext = Record<string, string | number | boolean | null>;
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

let reporter: ErrorReporter = () => {};

/** Replaces the reporter. Returns a function that puts the previous one back. */
export function setErrorReporter(next: ErrorReporter): () => void {
  const previous = reporter;
  reporter = next;
  return () => {
    reporter = previous;
  };
}

/** Reports an error. A reporter that fails is ignored: reporting never breaks the app. */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  try {
    reporter(error, context);
  } catch {
    // Nothing more to do.
  }
}
