import type { ZodError } from 'zod';

import { type Issue, issuePath } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { type AppConfig, AppConfigSchema } from './schema.js';

export const DEFAULT_APP_CONFIG: AppConfig = AppConfigSchema.parse({});

const toIssues = (error: ZodError): Issue[] =>
  error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message }));

/** Checks `input` strictly: an unknown key or a bad value is an issue. Fills the defaults. */
export function validateAppConfig(input: unknown): Result<AppConfig, Issue[]> {
  const parsed = AppConfigSchema.safeParse(input ?? {});
  return parsed.success ? ok(parsed.data) : err(toIssues(parsed.error));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Removes the value at `path`, so its default applies. Returns false if there is none. */
function drop(root: unknown, path: readonly PropertyKey[], keys: readonly string[]): boolean {
  let at: unknown = root;
  for (const step of path) {
    if (!isRecord(at) && !Array.isArray(at)) return false;
    at = (at as Record<PropertyKey, unknown>)[step];
  }
  if (keys.length > 0) {
    if (!isRecord(at)) return false;
    for (const key of keys) delete at[key];
    return true;
  }
  if (path.length === 0) return false;
  let parent: unknown = root;
  for (const step of path.slice(0, -1)) parent = (parent as Record<PropertyKey, unknown>)[step];
  const last = path[path.length - 1]!;
  if (Array.isArray(parent)) {
    // An element that is wrong takes the whole list back to its default.
    return drop(root, path.slice(0, -1), []);
  }
  if (!Object.hasOwn(parent as object, last as string)) return false;
  delete (parent as Record<PropertyKey, unknown>)[last as string];
  return true;
}

export type ParsedConfig = { config: AppConfig; ignored: Issue[] };

/**
 * Reads a configuration from anywhere, such as the server or a stored copy, and never
 * refuses it: each field that is not valid, and each key that is not known, is ignored and
 * takes its default. `ignored` says what was dropped. Only input that is not an object is
 * an error.
 */
export function parseAppConfig(input: unknown): Result<ParsedConfig, Issue> {
  if (!isRecord(input)) return err({ path: '', message: 'The configuration must be an object.' });
  const work = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const ignored: Issue[] = [];
  // Each pass removes at least one offending value, so this ends; the bound is a backstop.
  for (let pass = 0; pass < 500; pass += 1) {
    const parsed = AppConfigSchema.safeParse(work);
    if (parsed.success) return ok({ config: parsed.data, ignored });
    for (const issue of parsed.error.issues) {
      const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
      ignored.push({ path: issuePath(issue.path), message: issue.message });
      if (!drop(work, issue.path, keys)) {
        // A rule over a whole section, or the whole value: that part starts again.
        const section = issue.path[0];
        if (section === undefined) return ok({ config: DEFAULT_APP_CONFIG, ignored });
        delete work[section as string];
      }
    }
  }
  /* c8 ignore next */
  return ok({ config: DEFAULT_APP_CONFIG, ignored });
}
