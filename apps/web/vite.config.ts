import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolve @ezd/core to its TypeScript source so dev, test and build need no prior core build.
  resolve: { conditions: ['@ezd/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@ezd/source', ...defaultServerConditions] } },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The end-to-end tests in e2e/ run under Playwright: `pnpm --filter @ezd/web e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
