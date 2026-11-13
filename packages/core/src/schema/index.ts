import { z } from 'zod';

import { SEED_CATALOG } from '../catalog/index.js';
import { CommandSchema } from '../commands/index.js';
import { DesignDocumentSchema } from '../document/index.js';
import { llmToolDefinitions } from '../llm/index.js';
import { DraftRoomSchema, RoomDraftSchema } from '../photo/index.js';

// JSON Schema for callers that cannot import core, such as the Python API. It covers
// structure only: referential integrity is checked by `parseDocument` and `applyCommand`.
// The document schema describes what `parseDocument` accepts, so fields with a default
// are optional.
// `scripts/export-schema.mjs` writes both to `packages/core/schema/`.

export type JsonSchema = Record<string, unknown>;

export const designDocumentJsonSchema = (): JsonSchema => ({
  title: 'EZDesign Design Document',
  ...z.toJSONSchema(DesignDocumentSchema, { io: 'input' }),
});

export const commandsJsonSchema = (): JsonSchema => ({
  title: 'EZDesign Command',
  ...z.toJSONSchema(CommandSchema),
});

/** The chat assistant's tools for the seed catalog, as the server sends them to the model. */
export const llmToolsJsonSchema = (): JsonSchema => ({
  title: 'EZDesign LLM tools',
  catalogVersion: SEED_CATALOG.version,
  tools: llmToolDefinitions(SEED_CATALOG),
});

/**
 * The vision model's answer, for the vendor's strict structured output and the server's
 * check of it. Without `$schema`, which structured output does not accept.
 */
export const draftRoomJsonSchema = (): JsonSchema => {
  const schema: JsonSchema = { ...z.toJSONSchema(DraftRoomSchema) };
  delete schema.$schema;
  return { title: 'EZDesign draft room (photo analysis)', ...schema };
};

/** A draft as the server stores it and the correction screen saves it. */
export const roomDraftJsonSchema = (): JsonSchema => ({
  title: 'EZDesign room draft',
  ...z.toJSONSchema(RoomDraftSchema),
});
