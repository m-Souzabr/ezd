import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @ezd/core to its TypeScript source so tests do not need a prior build.
  resolve: { conditions: ['@ezd/source'] },
  ssr: { resolve: { conditions: ['@ezd/source'] } },
});
