// Writes the JSON Schema files in packages/core/schema from the Zod schemas.
// Run through `pnpm --filter @ezd/core schema`, which builds core first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  catalogIndexForLLM,
  commandsJsonSchema,
  designDocumentJsonSchema,
  draftRoomJsonSchema,
  llmToolsJsonSchema,
  roomDraftJsonSchema,
  SEED_CATALOG,
} from '../dist/index.js';

const outDir = resolve(import.meta.dirname, '..', 'schema');
mkdirSync(outDir, { recursive: true });

const files = {
  'design-document.schema.json': designDocumentJsonSchema(),
  'commands.schema.json': commandsJsonSchema(),
  'llm-tools.schema.json': llmToolsJsonSchema(),
  'draft-room.schema.json': draftRoomJsonSchema(),
  'room-draft.schema.json': roomDraftJsonSchema(),
};
for (const [name, schema] of Object.entries(files)) {
  writeFileSync(join(outDir, name), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${name}`);
}

// The catalog as the model reads it: part of the prompt prefix the server sends unchanged.
writeFileSync(join(outDir, 'llm-catalog-index.txt'), `${catalogIndexForLLM(SEED_CATALOG)}\n`);
console.log('wrote schema/llm-catalog-index.txt');
