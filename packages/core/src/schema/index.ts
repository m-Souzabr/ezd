import { z } from 'zod';

import { type Catalog, CatalogSchema } from '../catalog/index.js';
import { QuoteDefaultsSchema } from '../bom/index.js';
import { AppConfigSchema } from '../config/index.js';
import { CommandSchema } from '../commands/index.js';
import { DesignDocumentSchema } from '../document/index.js';
import { llmToolDefinitions } from '../llm/index.js';
import { DraftRoomSchema, RoomDraftSchema } from '../photo/index.js';
import { RulesConfigSchema } from '../rules/index.js';

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

/** The chat assistant's tools for a catalog, as the server sends them to the model. */
export const llmToolsJsonSchema = (catalog: Catalog): JsonSchema => ({
  title: 'EZDesign LLM tools',
  catalogVersion: catalog.version,
  tools: llmToolDefinitions(catalog),
});

/** A catalog, as the Control Panel stores and publishes it. */
export const catalogJsonSchema = (): JsonSchema => ({
  title: 'EZDesign catalog',
  ...z.toJSONSchema(CatalogSchema),
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

/** The Control Panel's app configuration. Every field is optional: defaults fill the rest. */
export const appConfigJsonSchema = (): JsonSchema => ({
  title: 'EZDesign app config',
  ...z.toJSONSchema(AppConfigSchema, { io: 'input' }),
});

/** The design rules' configuration: switches, severities, thresholds and snap options. */
export const rulesConfigJsonSchema = (): JsonSchema => ({
  title: 'EZDesign rules config',
  ...z.toJSONSchema(RulesConfigSchema, { io: 'input' }),
});

/** The defaults of a new quote and the branding of its PDF. */
export const quoteDefaultsJsonSchema = (): JsonSchema => ({
  title: 'EZDesign quote defaults',
  ...z.toJSONSchema(QuoteDefaultsSchema, { io: 'input' }),
});
