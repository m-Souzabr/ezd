// Writes the JSON Schema files in packages/core/schema from the Zod schemas.
// Run through `pnpm --filter @ezd/core schema`, which builds core first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { commandsJsonSchema, designDocumentJsonSchema } from '../dist/index.js';

const outDir = resolve(import.meta.dirname, '..', 'schema');
mkdirSync(outDir, { recursive: true });

const files = {
  'design-document.schema.json': designDocumentJsonSchema(),
  'commands.schema.json': commandsJsonSchema(),
};
for (const [name, schema] of Object.entries(files)) {
  writeFileSync(join(outDir, name), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${name}`);
}
