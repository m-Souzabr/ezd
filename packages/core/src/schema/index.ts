import { z } from 'zod';

import { CommandSchema } from '../commands/index.js';
import { DesignDocumentSchema } from '../document/index.js';

// JSON Schema for callers that cannot import core, such as the Python API. It covers
// structure only: referential integrity is checked by `parseDocument` and `applyCommand`.
// `scripts/export-schema.mjs` writes both to `packages/core/schema/`.

export type JsonSchema = Record<string, unknown>;

export const designDocumentJsonSchema = (): JsonSchema => ({
  title: 'EZDesign Design Document',
  ...z.toJSONSchema(DesignDocumentSchema),
});

export const commandsJsonSchema = (): JsonSchema => ({
  title: 'EZDesign Command',
  ...z.toJSONSchema(CommandSchema),
});
