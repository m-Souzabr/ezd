import { describeIssues, type Issue } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { inches } from '../units/index.js';
import { type DesignDocument, DesignDocumentSchema, type Id, toIssues } from './schema.js';

export const DEFAULT_CEILING_HEIGHT = inches(96);
export const DEFAULT_WALL_THICKNESS = inches(4.5);

export type SchemaError = { code: 'SCHEMA'; message: string; issues: Issue[] };

/** A document with no walls and no items. It is valid when `id` and `name` are. */
export function createEmptyDocument({ id, name }: { id: Id; name: string }): DesignDocument {
  return {
    schemaVersion: 1,
    id,
    name,
    room: { ceilingHeight: DEFAULT_CEILING_HEIGHT, walls: [], openings: [] },
    items: [],
  };
}

/** Validates structure and referential integrity. */
export function parseDocument(input: unknown): Result<DesignDocument, SchemaError> {
  const parsed = DesignDocumentSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const issues = toIssues(parsed.error);
  return err({ code: 'SCHEMA', message: `Invalid document: ${describeIssues(issues)}`, issues });
}
