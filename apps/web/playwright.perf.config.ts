import { defineConfig, devices } from '@playwright/test';

const PORT = 5298;

// The browser-side performance targets of #12, measured on the production build served by
// `vite preview`: `pnpm --filter @ezd/web perf`. Not part of CI, whose shared runners make
// frame timings noisy; the numbers go in docs/PERFORMANCE.md.
export default defineConfig({
  testDir: './perf',
  testMatch: '*.perf.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `vite build && vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
