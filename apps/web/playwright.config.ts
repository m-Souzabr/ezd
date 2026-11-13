import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const API_PORT = 8010;
const CI = Boolean(process.env.CI);

// End-to-end tests drive the editor in a real browser against the Vite dev server, which
// is the build that exposes `window.__ezd`. The tests of accounts and saved designs also
// need the API: Django's `testserver` runs it on a database of its own (`test_ezd`, made
// empty on each start), so PostgreSQL must be up, as for pytest. It runs on its own port,
// so a `runserver` on 8000 is left alone. The API validates documents with `ezd-core`,
// which is built first.
export default defineConfig({
  testDir: './e2e',
  // Each test signs up its own account and makes its own data, so tests run side by side.
  fullyParallel: true,
  workers: CI ? 2 : 4,
  // The account flows sign up, save and reload several times; give them room under load.
  timeout: 60_000,
  forbidOnly: CI,
  // A test passes on its first run or not at all: fix a flaky test, never retry it.
  retries: 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command:
        'pnpm --filter @ezd/core-cli build && cd ../api && ' +
        `uv run python manage.py testserver tests/fixtures/empty.json --noinput --addrport 127.0.0.1:${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health/`,
      // Without the line the API logs for each request. The assistant answers from a script.
      env: {
        DJANGO_LOG_LEVEL: 'WARNING',
        LLM_VENDOR: 'fake',
        LLM_FAKE_SCRIPT: resolve('e2e/llm-script.json'),
        // Every test signs in from 127.0.0.1, in parallel.
        API_THROTTLE_LOGIN_IP: '1000/min',
        API_THROTTLE_AUTH_IP: '1000/min',
      },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: `vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      env: { EZD_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !CI,
    },
  ],
});
