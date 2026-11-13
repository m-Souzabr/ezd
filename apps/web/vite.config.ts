import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions, loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// Where the dev server sends `/api`. The end-to-end tests point it at their own API.
const { EZD_API_URL = 'http://localhost:8000' } = loadEnv('development', '.', 'EZD_');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolve @ezd/core to its TypeScript source so dev, test and build need no prior core build.
  resolve: {
    conditions: ['@ezd/source', ...defaultClientConditions],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  ssr: { resolve: { conditions: ['@ezd/source', ...defaultServerConditions] } },
  server: {
    proxy: {
      '/api': EZD_API_URL,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The end-to-end tests in e2e/ run under Playwright: `pnpm --filter @ezd/web e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
