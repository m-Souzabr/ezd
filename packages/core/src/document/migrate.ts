import type { Issue } from '../issues.js';
import { err, type Result } from '../result.js';
import { parseDocument } from './parse.js';
import { type DesignDocument, SCHEMA_VERSION } from './schema.js';

export type MigrationError = {
  code: 'NOT_A_DOCUMENT' | 'UNKNOWN_VERSION' | 'NEWER_VERSION' | 'INVALID_DOCUMENT';
  message: string;
  issues?: Issue[];
};

/**
 * A migration takes a document at the version it is registered under. Below the current
 * version it returns the document at a later version; at the current version it is the
 * identity.
 */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
export type MigrationRegistry = Readonly<Record<number, Migration>>;

const MIGRATIONS: MigrationRegistry = {
  1: (doc) => doc,
};

/** Brings a stored document of any known version to the current schema and validates it. */
export function migrate(input: unknown): Result<DesignDocument, MigrationError> {
  return migrateWith(MIGRATIONS, SCHEMA_VERSION, input);
}

const versionOf = (doc: unknown): number | null => {
  if (typeof doc !== 'object' || doc === null) return null;
  const version = (doc as Record<string, unknown>).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) ? version : null;
};

/** `migrate` with the registry and target version as parameters, for tests. */
export function migrateWith(
  registry: MigrationRegistry,
  current: number,
  input: unknown,
): Result<DesignDocument, MigrationError> {
  let doc = input;
  for (;;) {
    const version = versionOf(doc);
    if (version === null) {
      return err({
        code: 'NOT_A_DOCUMENT',
        message: 'Not a design document: it has no integer schemaVersion.',
      });
    }
    if (version > current) {
      return err({
        code: 'NEWER_VERSION',
        message: `Document version ${version} is newer than this build supports (${current}).`,
      });
    }
    const step = registry[version];
    if (!step) {
      return err({ code: 'UNKNOWN_VERSION', message: `Unknown document version ${version}.` });
    }
    doc = step(doc as Record<string, unknown>);
    if (version === current) break;
    if ((versionOf(doc) ?? version) <= version) {
      return err({
        code: 'UNKNOWN_VERSION',
        message: `The migration from version ${version} did not advance the document.`,
      });
    }
  }

  const parsed = parseDocument(doc);
  if (parsed.ok) return parsed;
  return err({
    code: 'INVALID_DOCUMENT',
    message: parsed.error.message,
    issues: parsed.error.issues,
  });
}
